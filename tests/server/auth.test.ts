import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../server/db";
import { makeAuditWriter, listEvents } from "../../server/audit";
import { updateGlobal } from "../../server/settings";
import { hashPin, verifyPin, isValidPin, isLockedOut, login, checkSession, logout, __resetSessions } from "../../server/auth";

const T0 = new Date("2026-11-10T10:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const setup = (pin: string | null = "123456") => {
  const db = openDb(":memory:");
  const audit = makeAuditWriter(db);
  if (pin) updateGlobal(db, { pinHash: hashPin(pin) }, audit);
  return { db, audit };
};
beforeEach(() => __resetSessions());

describe("pin hashing", () => {
  it("round-trips and rejects wrong pin", () => {
    const h = hashPin("123456");
    expect(h).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(verifyPin("123456", h)).toBe(true);
    expect(verifyPin("654321", h)).toBe(false);
  });
  it("malformed stored value is false, not a throw", () => {
    expect(verifyPin("123456", "garbage")).toBe(false);
    expect(verifyPin("123456", "zz:yy")).toBe(false);
    expect(verifyPin("123456", "")).toBe(false);
  });
  it("isValidPin needs exactly 6 digits", () => {
    expect(isValidPin("1234")).toBe(false);
    expect(isValidPin("12345a")).toBe(false);
    expect(isValidPin("1234567")).toBe(false);
    expect(isValidPin("123456")).toBe(true);
  });
});

describe("login and lockout", () => {
  it("correct pin returns a 64-hex token and logs pin_success", () => {
    const { db, audit } = setup();
    const r = login(db, audit, "123456", T0);
    expect(r.ok && r.token).toMatch(/^[0-9a-f]{64}$/);
    expect(listEvents(db, { type: "pin_success" })).toHaveLength(1);
  });
  it("no pin set or malformed pin: not ok, not locked, pin_fail logged", () => {
    const a = setup(null);
    expect(login(a.db, a.audit, "123456", T0)).toEqual({ ok: false, locked: false });
    const b = setup();
    expect(login(b.db, b.audit, "12", T0)).toEqual({ ok: false, locked: false });
    expect(listEvents(a.db, { type: "pin_fail" })).toHaveLength(1);
    expect(listEvents(b.db, { type: "pin_fail" })).toHaveLength(1);
  });
  it("5 failures lock out even the correct pin; unlocks after 15 min 1 s", () => {
    const { db, audit } = setup();
    for (let i = 0; i < 5; i++) expect(login(db, audit, "000000", at(i * 1000))).toEqual({ ok: false, locked: false });
    expect(isLockedOut(db, at(6000))).toBe(true);
    expect(login(db, audit, "123456", at(6000))).toEqual({ ok: false, locked: true });
    const fails = listEvents(db, { type: "pin_fail" });
    expect(fails).toHaveLength(6);
    expect(fails[5].detail).toEqual({ locked: true });
    // blocked attempts count toward the window, so hammering keeps it locked
    for (let i = 0; i < 4; i++) login(db, audit, "123456", at(600000 + i * 1000));
    expect(login(db, audit, "123456", at(6000 + 15 * 60000 - 1000))).toEqual({ ok: false, locked: true });
    expect(login(db, audit, "123456", at(604000 + 15 * 60000 + 1000)).ok).toBe(true);
  });
  it("success resets the count", () => {
    const { db, audit } = setup();
    for (let i = 0; i < 4; i++) login(db, audit, "000000", at(i * 1000));
    expect(login(db, audit, "123456", at(5000)).ok).toBe(true);
    for (let i = 0; i < 4; i++) login(db, audit, "000000", at(6000 + i * 1000));
    expect(isLockedOut(db, at(11000))).toBe(false);
  });
  it("lockout is derived from the db, so a new writer still sees it", () => {
    const { db, audit } = setup();
    for (let i = 0; i < 5; i++) login(db, audit, "000000", at(i * 1000));
    expect(isLockedOut(db, at(6000))).toBe(true);
  });
});

describe("sessions", () => {
  const tok = () => { const { db, audit } = setup(); const r = login(db, audit, "123456", T0); if (!r.ok) throw 0; return r.token; };
  it("valid at +9 min, invalid and deleted at +10 min 1 s idle", () => {
    const t = tok();
    expect(checkSession(t, at(9 * 60000))).toBe(true);
    expect(checkSession(t, at(9 * 60000 + 10 * 60000))).toBe(true); // refreshed at +9
    expect(checkSession(t, at(19 * 60000 + 10 * 60000 + 1000))).toBe(false);
    expect(checkSession(t, at(19 * 60000 + 10 * 60000 + 2000))).toBe(false);
  });
  it("idle just over 10 min is invalid", () => {
    expect(checkSession(tok(), at(10 * 60000 + 1000))).toBe(false);
  });
  it("undefined/unknown token and logout", () => {
    const t = tok();
    expect(checkSession(undefined, T0)).toBe(false);
    expect(checkSession("nope", T0)).toBe(false);
    logout(t);
    expect(checkSession(t, T0)).toBe(false);
  });
});
