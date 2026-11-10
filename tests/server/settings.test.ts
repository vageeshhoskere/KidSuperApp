import { describe, it, expect, vi } from "vitest";
import { openDb } from "../../server/db";
import {
  getGlobal, updateGlobal, getChild, createChild, updateChild,
  DEFAULT_GLOBAL_SETTINGS, DEFAULT_CHILD_SETTINGS,
} from "../../server/settings";

const setup = () => {
  const db = openDb(":memory:");
  const audit = { logRequest() {}, logEvent: vi.fn() };
  return { db, audit };
};
const smtp = { host: "h", port: 25, user: "u", pass: "secret", from: "a@b.c", to: "d@e.f" };

describe("settings", () => {
  it("fresh db returns defaults", () => {
    const { db } = setup();
    expect(getGlobal(db)).toEqual(DEFAULT_GLOBAL_SETTINGS);
    const id = createChild(db, { name: "Kit", avatar: "fox", age: 7 });
    expect(getChild(db, id)).toEqual({ id, name: "Kit", avatar: "fox", age: 7, settings: DEFAULT_CHILD_SETTINGS });
    expect(getChild(db, 99)).toBeNull();
  });
  it("rejects invalid values", () => {
    const { db, audit } = setup();
    const id = createChild(db, { name: "K", avatar: "a", age: 7 });
    expect(() => updateGlobal(db, { moderationThreshold: 0.6 }, audit)).toThrow();
    expect(() => updateGlobal(db, { retentionDays: 0 }, audit)).toThrow();
    expect(() => updateChild(db, id, { buildsPerDay: 501 }, audit)).toThrow();
    expect(() => updateChild(db, id, { hoursStart: "8:00" }, audit)).toThrow();
    expect(audit.logEvent).not.toHaveBeenCalled();
  });
  it("logs one settings_change per changed key only", () => {
    const { db, audit } = setup();
    updateGlobal(db, { retentionDays: 30, moderationThreshold: 0.2 }, audit);
    expect(audit.logEvent).toHaveBeenCalledTimes(1);
    expect(audit.logEvent).toHaveBeenCalledWith("settings_change", { key: "retentionDays", old: 90, new: 30 });
    expect(getGlobal(db).retentionDays).toBe(30);
  });
  it("masks pinHash and smtp.pass", () => {
    const { db, audit } = setup();
    updateGlobal(db, { pinHash: "abc", smtp }, audit);
    const calls = audit.logEvent.mock.calls.map((c) => c[1]);
    expect(calls).toContainEqual({ key: "pinHash", old: null, new: "***" });
    expect(calls).toContainEqual({ key: "smtp", old: null, new: { ...smtp, pass: "***" } });
    expect(JSON.stringify(calls)).not.toContain("secret");
    expect(getGlobal(db).smtp?.pass).toBe("secret");
  });
  it("notify needs smtp; child changes merge over defaults", () => {
    const { db, audit } = setup();
    const id = createChild(db, { name: "K", avatar: "a", age: 7 });
    expect(() => updateChild(db, id, { flagHandling: "notify" }, audit)).toThrow();
    updateGlobal(db, { smtp }, audit);
    audit.logEvent.mockClear();
    updateChild(db, id, { flagHandling: "notify", voice: true }, audit);
    expect(getChild(db, id)!.settings).toEqual({ ...DEFAULT_CHILD_SETTINGS, flagHandling: "notify", voice: true });
    expect(audit.logEvent).toHaveBeenCalledWith("settings_change", { childId: id, key: "flagHandling", old: "redirect", new: "notify" });
  });
});
