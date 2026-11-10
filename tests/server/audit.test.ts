import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { openDb } from "../../server/db";
import { createChild } from "../../server/settings";
import {
  makeAuditWriter, listRequests, getRequest, listEvents, listHeld, countBuildsSince,
  toCsv, purgeOlderThan, type AuditRequest,
} from "../../server/audit";

const ok = { result: "pass" as const, detail: { a: 1 } };
const req = (o: Partial<AuditRequest> = {}): AuditRequest => ({
  id: crypto.randomUUID(), createdAt: "2026-11-10T10:00:00.000Z", childId: 1, inputMode: "typed",
  inputText: "a red cube", layer1: ok, layer2: { result: "skipped", detail: null }, layer3: ok,
  intent: "build", summary: "cube", builder: { provider: "openai", model: "m" }, checker: { provider: "google", model: "c" },
  outputText: ok, pictureCheck: { result: "fail", detail: "x" }, outcome: "shown", errorDetail: null,
  raw: ["r1", "r2"], scene: { title: "Cube", blocks: [{ shape: "cube", color: "red", position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0] }] },
  parentRequestId: "p1", ...o,
});
const setup = () => { const db = openDb(":memory:"); return { db, w: makeAuditWriter(db) }; };
const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * 86400000).toISOString();

describe("audit", () => {
  it("round-trips every field, incl. nulls", () => {
    const { db, w } = setup();
    const a = req(), b = req({ intent: null, summary: null, builder: null, checker: null, outputText: null, pictureCheck: null, scene: null, parentRequestId: null, raw: [] });
    w.logRequest(a); w.logRequest(b);
    expect(getRequest(db, a.id)).toEqual(a);
    expect(getRequest(db, b.id)).toEqual(b);
    expect(getRequest(db, "nope")).toBeNull();
  });
  it("lists newest first, filters, counts builds", () => {
    const { db, w } = setup();
    w.logRequest(req({ id: "1", createdAt: "2026-11-01T00:00:00.000Z" }));
    w.logRequest(req({ id: "2", createdAt: "2026-11-03T00:00:00.000Z", outcome: "redirected" }));
    w.logRequest(req({ id: "3", createdAt: "2026-11-02T00:00:00.000Z", outcome: "closed", childId: 2 }));
    expect(listRequests(db, {}).map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(listRequests(db, { outcome: "redirected" }).map((r) => r.id)).toEqual(["2"]);
    expect(listRequests(db, { childId: 2 }).map((r) => r.id)).toEqual(["3"]);
    expect(listRequests(db, { from: "2026-11-02T00:00:00.000Z", to: "2026-11-02T23:59:59.999Z" }).map((r) => r.id)).toEqual(["3"]);
    expect(listRequests(db, { limit: 1, offset: 1 }).map((r) => r.id)).toEqual(["3"]);
    expect(countBuildsSince(db, 1, "2026-10-01T00:00:00.000Z")).toBe(2);
    expect(countBuildsSince(db, 2, "2026-10-01T00:00:00.000Z")).toBe(0);
    expect(countBuildsSince(db, 1, "2026-11-02T00:00:00.000Z")).toBe(1);
  });
  it("listHeld excludes decided rows; events filter", () => {
    const { db, w } = setup();
    w.logRequest(req({ id: "h1", outcome: "held" }));
    w.logRequest(req({ id: "h2", outcome: "held" }));
    expect(listHeld(db).map((r) => r.id).sort()).toEqual(["h1", "h2"]);
    w.logEvent("hold_decision", { approved: true }, "h1");
    expect(listHeld(db).map((r) => r.id)).toEqual(["h2"]);
    const ev = listEvents(db, { type: "hold_decision" });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "hold_decision", relatedRequestId: "h1", detail: { approved: true } });
    expect(listEvents(db, { since: "2999-01-01T00:00:00.000Z" })).toEqual([]);
  });
  it("purge removes old rows in both tables, keeps creations, logs one event", () => {
    const { db, w } = setup();
    const cid = createChild(db, { name: "K", avatar: "a", age: 7 });
    db.prepare("INSERT INTO creations (child_id, title, created_at) VALUES (?, 'old', '2000-01-01T00:00:00.000Z')").run(cid);
    const now = new Date("2026-11-10T00:00:00.000Z");
    w.logRequest(req({ id: "old", createdAt: daysAgo(now, 91) }));
    w.logRequest(req({ id: "new", createdAt: daysAgo(now, 89) }));
    expect(purgeOlderThan(db, 90, now)).toBe(1);
    expect(listRequests(db, {}).map((r) => r.id)).toEqual(["new"]);
    expect(db.prepare("SELECT count(*) c FROM creations").get()).toEqual({ c: 1 });
    const ev = listEvents(db, { type: "purge" });
    expect(ev).toHaveLength(1);
    expect(ev[0].detail).toEqual({ deleted: 1 });
  });
  it("purge also removes old events", () => {
    const { db } = setup();
    db.prepare("INSERT INTO audit_events (created_at, type, detail) VALUES ('2000-01-01T00:00:00.000Z', 'pin_fail', '{}')").run();
    expect(purgeOlderThan(db, 90, new Date())).toBe(1);
    expect(listEvents(db, { type: "pin_fail" })).toEqual([]);
  });
  it("toCsv quotes commas, quotes and newlines", () => {
    const csv = toCsv([req({ inputText: 'a, "b"\nc' })]);
    const [header] = csv.split("\r\n");
    expect(header.startsWith("id,createdAt,childId")).toBe(true);
    expect(csv).toContain('"a, ""b""\nc"');
    expect(toCsv([])).toBe(header + "\r\n");
  });
  it("writer throws on write failure", () => {
    const { db, w } = setup();
    db.exec("DROP TABLE audit_events");
    expect(() => w.logEvent("pin_fail", {})).toThrow();
  });
  it("UPDATE/DELETE appear only inside purgeOlderThan", () => {
    const src = fs.readFileSync("server/audit.ts", "utf8");
    const i = src.indexOf("export function purgeOlderThan");
    const j = src.indexOf("\n}\n", i);
    const outside = src.slice(0, i) + src.slice(j);
    expect(outside).not.toMatch(/UPDATE|DELETE/);
    expect(src.slice(i, j)).toMatch(/DELETE/);
  });
});
