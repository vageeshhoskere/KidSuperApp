import type { Db } from "./db";
import type { Scene } from "../shared/scene";
import type { ModelChoice } from "./settings";

export type LayerResult = { result: "pass" | "fail" | "skipped"; detail: unknown };
export type AuditRequest = {
  id: string; createdAt: string; childId: number;
  inputMode: "typed" | "voice" | "pictures"; inputText: string;
  layer1: LayerResult; layer2: LayerResult; layer3: LayerResult;
  intent: string | null; summary: string | null;
  builder: ModelChoice | null; checker: ModelChoice | null;
  outputText: LayerResult | null; pictureCheck: LayerResult | null;
  outcome: "shown" | "redirected" | "held" | "closed" | "error"; errorDetail: string | null;
  raw: string[]; scene: Scene | null; parentRequestId: string | null;
};
export type AuditEventType = "settings_change" | "pin_success" | "pin_fail" | "hold_decision" | "purge";
export type AuditWriter = {
  logRequest(r: AuditRequest): void;
  logEvent(type: AuditEventType, detail: unknown, relatedRequestId?: string): void;
};

const J = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const P = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T));

export function makeAuditWriter(db: Db): AuditWriter {
  const insReq = db.prepare(`INSERT INTO audit_requests
    (id, created_at, child_id, input_mode, input_text, layer1, layer2, layer3, intent, summary, builder, checker,
     output_text, picture_check, outcome, error_detail, raw, scene, parent_request_id)
    VALUES (@id, @createdAt, @childId, @inputMode, @inputText, @layer1, @layer2, @layer3, @intent, @summary, @builder, @checker,
     @outputText, @pictureCheck, @outcome, @errorDetail, @raw, @scene, @parentRequestId)`);
  const insEvt = db.prepare("INSERT INTO audit_events (created_at, type, related_request_id, detail) VALUES (?, ?, ?, ?)");
  return {
    logRequest: (r) =>
      void insReq.run({
        ...r, layer1: J(r.layer1), layer2: J(r.layer2), layer3: J(r.layer3), builder: J(r.builder), checker: J(r.checker),
        outputText: J(r.outputText), pictureCheck: J(r.pictureCheck), raw: J(r.raw), scene: J(r.scene),
      }),
    logEvent: (type, detail, related) =>
      void insEvt.run(new Date().toISOString(), type, related ?? null, JSON.stringify(detail ?? null)),
  };
}

type ReqRow = Record<string, string | number | null>;
const fromRow = (r: ReqRow): AuditRequest => ({
  id: r.id as string, createdAt: r.created_at as string, childId: r.child_id as number,
  inputMode: r.input_mode as AuditRequest["inputMode"], inputText: r.input_text as string,
  layer1: P(r.layer1 as string)!, layer2: P(r.layer2 as string)!, layer3: P(r.layer3 as string)!,
  intent: r.intent as string | null, summary: r.summary as string | null,
  builder: P(r.builder as string | null), checker: P(r.checker as string | null),
  outputText: P(r.output_text as string | null), pictureCheck: P(r.picture_check as string | null),
  outcome: r.outcome as AuditRequest["outcome"], errorDetail: r.error_detail as string | null,
  raw: P<string[]>(r.raw as string)!, scene: P(r.scene as string | null), parentRequestId: r.parent_request_id as string | null,
});

export function listRequests(
  db: Db,
  f: { childId?: number; from?: string; to?: string; outcome?: string; limit?: number; offset?: number },
): AuditRequest[] {
  const w: string[] = [];
  const a: (string | number)[] = [];
  if (f.childId !== undefined) { w.push("child_id = ?"); a.push(f.childId); }
  if (f.from) { w.push("created_at >= ?"); a.push(f.from); }
  if (f.to) { w.push("created_at <= ?"); a.push(f.to); }
  if (f.outcome) { w.push("outcome = ?"); a.push(f.outcome); }
  const sql = `SELECT * FROM audit_requests${w.length ? " WHERE " + w.join(" AND ") : ""}
    ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`;
  return (db.prepare(sql).all(...a, f.limit ?? -1, f.offset ?? 0) as ReqRow[]).map(fromRow);
}

export function getRequest(db: Db, id: string): AuditRequest | null {
  const r = db.prepare("SELECT * FROM audit_requests WHERE id = ?").get(id) as ReqRow | undefined;
  return r ? fromRow(r) : null;
}

export function listEvents(db: Db, f: { type?: string; since?: string }) {
  const w: string[] = [];
  const a: string[] = [];
  if (f.type) { w.push("type = ?"); a.push(f.type); }
  if (f.since) { w.push("created_at >= ?"); a.push(f.since); }
  const sql = `SELECT * FROM audit_events${w.length ? " WHERE " + w.join(" AND ") : ""} ORDER BY id`;
  return (db.prepare(sql).all(...a) as ReqRow[]).map((r) => ({
    id: r.id as number, createdAt: r.created_at as string, type: r.type as string,
    relatedRequestId: r.related_request_id as string | null, detail: JSON.parse(r.detail as string) as unknown,
  }));
}

export function listHeld(db: Db): AuditRequest[] {
  const rows = db.prepare(`SELECT * FROM audit_requests r WHERE outcome = 'held' AND NOT EXISTS
    (SELECT 1 FROM audit_events e WHERE e.type = 'hold_decision' AND e.related_request_id = r.id)
    ORDER BY created_at DESC, rowid DESC`).all() as ReqRow[];
  return rows.map(fromRow);
}

export function countBuildsSince(db: Db, childId: number, sinceIso: string): number {
  const r = db.prepare("SELECT count(*) c FROM audit_requests WHERE child_id = ? AND created_at >= ? AND outcome != 'closed'")
    .get(childId, sinceIso) as { c: number };
  return r.c;
}

const CSV_COLS: (keyof AuditRequest)[] = [
  "id", "createdAt", "childId", "inputMode", "inputText", "layer1", "layer2", "layer3", "intent", "summary",
  "builder", "checker", "outputText", "pictureCheck", "outcome", "errorDetail", "raw", "scene", "parentRequestId",
];
const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows: AuditRequest[]): string {
  return [CSV_COLS.join(","), ...rows.map((r) => CSV_COLS.map((c) => cell(r[c])).join(","))].map((l) => l + "\r\n").join("");
}

export function purgeOlderThan(db: Db, days: number, now: Date): number {
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  const deleted = db.transaction(() =>
    db.prepare("DELETE FROM audit_requests WHERE created_at < ?").run(cutoff).changes +
    db.prepare("DELETE FROM audit_events WHERE created_at < ?").run(cutoff).changes)();
  makeAuditWriter(db).logEvent("purge", { deleted });
  return deleted;
}
