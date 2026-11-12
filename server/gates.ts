import type { ChildSettings, GlobalSettings } from "./settings";

export type GateResult = { ok: true } | { ok: false; reason: "setup" | "hours" | "limit" | "mode" };

export const startOfLocalDay = (now: Date): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate());

export function checkGates(o: {
  global: GlobalSettings; child: ChildSettings; mode: "typed" | "voice" | "pictures"; buildsToday: number; now: Date;
}): GateResult {
  const { global, child, mode, buildsToday, now } = o;
  if (!global.setupComplete) return { ok: false, reason: "setup" };
  const allowed = { typed: child.typing, voice: child.voice, pictures: child.pictures }[mode];
  if (!allowed) return { ok: false, reason: "mode" };
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  // start === end means never open; no overnight windows (start > end is also closed)
  if (!(hhmm >= child.hoursStart && hhmm < child.hoursEnd)) return { ok: false, reason: "hours" };
  if (buildsToday >= child.buildsPerDay) return { ok: false, reason: "limit" };
  return { ok: true };
}
