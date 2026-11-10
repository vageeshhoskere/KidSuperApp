import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb, restrictDataPerms } from "../../server/db";
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
  parentRequestId: "p1", source: "child", baseScene: null, ...o,
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
  it("purge rolls back deletes if the purge event can't be written", () => {
    const { db, w } = setup();
    const now = new Date("2026-11-10T00:00:00.000Z");
    w.logRequest(req({ id: "old", createdAt: daysAgo(now, 91) }));
    db.exec("CREATE TRIGGER nopurge BEFORE INSERT ON audit_events WHEN NEW.type = 'purge' BEGIN SELECT RAISE(ABORT, 'no'); END");
    expect(() => purgeOlderThan(db, 90, now)).toThrow();
    expect(getRequest(db, "old")).not.toBeNull();
  });
  it("toCsv neutralises formula cells", () => {
    const csv = toCsv([req({ inputText: "=1+1", summary: "@x", intent: "-2" })]);
    expect(csv).toContain(",'=1+1,");
    expect(csv).toContain(",'-2,'@x,");
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

describe("audit source and base scene (final review #2, held baseScene)", () => {
  it("round-trips source and baseScene", () => {
    const { db, w } = setup();
    const a = req({ source: "redteam", baseScene: req().scene });
    w.logRequest(a);
    expect(getRequest(db, a.id)).toEqual(a);
  });
  it("countBuildsSince counts only child builds that were not closed or error", () => {
    const { db, w } = setup();
    const since = "2026-10-01T00:00:00.000Z";
    w.logRequest(req({ outcome: "shown" }));
    w.logRequest(req({ outcome: "redirected" }));
    w.logRequest(req({ outcome: "held" }));
    w.logRequest(req({ outcome: "error" }));
    w.logRequest(req({ outcome: "closed" }));
    w.logRequest(req({ outcome: "shown", source: "redteam" }));
    w.logRequest(req({ outcome: "shown", source: "test" }));
    expect(countBuildsSince(db, 1, since)).toBe(3);
  });
  it("CSV has a source column", () => {
    const csv = toCsv([req({ source: "test" })]);
    const [header, line] = csv.split("\r\n");
    expect(header.endsWith(",source,baseScene")).toBe(true);
    expect(line.endsWith(",test,")).toBe(true); // source, then the empty baseScene
  });
  it("an old db file without the new columns is upgraded with source default 'child'", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-mig-"));
    const file = path.join(dir, "app.db");
    const old = new Database(file);
    old.exec(`CREATE TABLE audit_requests (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, child_id INTEGER NOT NULL, input_mode TEXT NOT NULL, input_text TEXT NOT NULL,
      layer1 TEXT NOT NULL, layer2 TEXT NOT NULL, layer3 TEXT NOT NULL, intent TEXT, summary TEXT, builder TEXT, checker TEXT,
      output_text TEXT, picture_check TEXT, outcome TEXT NOT NULL, error_detail TEXT, raw TEXT NOT NULL, scene TEXT, parent_request_id TEXT);
      INSERT INTO audit_requests VALUES ('old', '2026-11-10T00:00:00.000Z', 1, 'typed', 'x', '{}', '{}', '{}', null, null, null, null, null, null, 'shown', null, '[]', null, null);`);
    old.close();
    const db = openDb(file);
    expect(getRequest(db, "old")).toMatchObject({ source: "child", baseScene: null });
    expect(countBuildsSince(db, 1, "2026-01-01T00:00:00.000Z")).toBe(1);
    db.close();
    expect(() => openDb(file).close()).not.toThrow(); // migration is idempotent
  });
});

describe("restrictDataPerms (final review minor: app.db permissions)", () => {
  it("sets the data dir to 0700 and app.db (+wal/shm) to 0600", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perms-"));
    fs.chmodSync(dir, 0o755);
    for (const f of ["app.db", "app.db-wal"]) fs.writeFileSync(path.join(dir, f), "", { mode: 0o644 });
    restrictDataPerms(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    for (const f of ["app.db", "app.db-wal"]) expect(fs.statSync(path.join(dir, f)).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(path.join(dir, "app.db-shm"))).toBe(false); // missing files are skipped, not created
  });
});
