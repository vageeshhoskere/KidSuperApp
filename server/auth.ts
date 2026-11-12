import crypto from "node:crypto";
import type { Db } from "./db";
import { listEvents, type AuditWriter } from "./audit";
import { getGlobal, updateGlobal } from "./settings";

const SCRYPT = { N: 16384, r: 8, p: 1 };
const LOCK_FAILS = 5;
const LOCK_MS = 15 * 60000;
const IDLE_MS = 10 * 60000;

export const isValidPin = (pin: string): boolean => /^\d{6}$/.test(pin);

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(pin, salt, 64, SCRYPT).toString("hex")}`;
}

/** Sets a new PIN (the `npm run reset-pin` CLI). Audited and masked by updateGlobal; an invalid PIN changes nothing. */
export function resetPin(db: Db, audit: AuditWriter, pin: string): void {
  if (!isValidPin(pin)) throw new Error("PIN must be 6 digits");
  if (getGlobal(db).pinHash === null) throw new Error("No PIN is set yet: open /parent and run the setup wizard.");
  updateGlobal(db, { pinHash: hashPin(pin) }, audit);
}

export function verifyPin(pin: string, stored: string): boolean {
  const m = /^([0-9a-f]{32}):([0-9a-f]{128})$/.exec(stored);
  if (!m) return false;
  const got = crypto.scryptSync(pin, Buffer.from(m[1], "hex"), 64, SCRYPT);
  return crypto.timingSafeEqual(got, Buffer.from(m[2], "hex"));
}

// Derived from audit events (survives restarts). Attempts blocked by the lockout are
// logged as pin_fail too, so they count toward the window: hammering keeps it locked.
export function isLockedOut(db: Db, now: Date): boolean {
  const lastOk = listEvents(db, { type: "pin_success" }).at(-1)?.createdAt ?? "";
  const since = new Date(now.getTime() - LOCK_MS).toISOString();
  const from = lastOk > since ? lastOk : since;
  return listEvents(db, { type: "pin_fail" }).filter((e) => e.createdAt > from).length >= LOCK_FAILS;
}

const sessions = new Map<string, Date>();
export const __resetSessions = (): void => sessions.clear();

export function login(
  db: Db, audit: AuditWriter, pin: string, now: Date,
): { ok: true; token: string } | { ok: false; locked: boolean } {
  if (isLockedOut(db, now)) {
    audit.logEvent("pin_fail", { locked: true }, undefined, now);
    return { ok: false, locked: true };
  }
  const stored = getGlobal(db).pinHash;
  if (stored && isValidPin(pin) && verifyPin(pin, stored)) {
    audit.logEvent("pin_success", null, undefined, now);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, now);
    return { ok: true, token };
  }
  audit.logEvent("pin_fail", { locked: false }, undefined, now);
  return { ok: false, locked: false };
}

export function checkSession(token: string | undefined, now: Date): boolean {
  const last = token ? sessions.get(token) : undefined;
  if (!token || !last) return false;
  if (now.getTime() - last.getTime() > IDLE_MS) { sessions.delete(token); return false; }
  sessions.set(token, now);
  return true;
}

export const logout = (token: string): void => void sessions.delete(token);
