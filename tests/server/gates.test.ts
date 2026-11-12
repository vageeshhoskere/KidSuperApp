import { describe, expect, it } from "vitest";
import { checkGates, startOfLocalDay } from "../../server/gates";
import { DEFAULT_CHILD_SETTINGS, DEFAULT_GLOBAL_SETTINGS } from "../../server/settings";

const at = (h: number, m = 0) => new Date(2026, 10, 10, h, m);
const run = (o: { global?: object; child?: object; mode?: "typed" | "voice" | "pictures"; builds?: number; now?: Date }) =>
  checkGates({
    global: { ...DEFAULT_GLOBAL_SETTINGS, setupComplete: true, ...o.global },
    child: { ...DEFAULT_CHILD_SETTINGS, ...o.child },
    mode: o.mode ?? "typed", buildsToday: o.builds ?? 0, now: o.now ?? at(12),
  });

describe("checkGates", () => {
  it("setup, mode", () => {
    expect(run({ global: { setupComplete: false } })).toEqual({ ok: false, reason: "setup" });
    expect(run({ mode: "voice" })).toEqual({ ok: false, reason: "mode" });
    expect(run({ mode: "voice", child: { voice: true } })).toEqual({ ok: true });
  });
  it("hours: start inclusive, end exclusive", () => {
    expect(run({ now: at(7, 59) })).toEqual({ ok: false, reason: "hours" });
    expect(run({ now: at(8) })).toEqual({ ok: true });
    expect(run({ now: at(18, 59) })).toEqual({ ok: true });
    expect(run({ now: at(19) })).toEqual({ ok: false, reason: "hours" });
    expect(run({ child: { hoursStart: "09:00", hoursEnd: "09:00" }, now: at(9) })).toEqual({ ok: false, reason: "hours" });
  });
  it("limit", () => {
    expect(run({ builds: 30 })).toEqual({ ok: false, reason: "limit" });
    expect(run({ builds: 29 })).toEqual({ ok: true });
  });
  it("startOfLocalDay", () => {
    expect(startOfLocalDay(at(23, 59)).getTime()).toBe(at(0).getTime());
  });
});
