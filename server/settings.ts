import { z } from "zod";
import type { Db } from "./db";
import type { AuditWriter } from "./audit";

export type ModelChoice = { provider: "openai" | "anthropic" | "google"; model: string };
export type ChildSettings = {
  typing: boolean; pictures: boolean; voice: boolean;
  stt: "browser" | "openai" | "google"; tts: boolean; ttsProvider: "browser" | "openai" | "google";
  flagHandling: "redirect" | "notify" | "hold"; pictureCheck: boolean;
  wordAdditions: string[]; allowedPhrases: string[];
  buildsPerDay: number; hoursStart: string; hoursEnd: string;
};
export type GlobalSettings = {
  setupComplete: boolean; pinHash: string | null;
  builder: ModelChoice | null; checker: ModelChoice | null;
  moderation: "openai" | "google" | "off"; moderationOffAcknowledged: boolean;
  moderationThreshold: number; retentionDays: number;
  smtp: { host: string; port: number; user: string; pass: string; from: string; to: string } | null;
};

export const DEFAULT_CHILD_SETTINGS: ChildSettings = {
  typing: true, pictures: true, voice: false, stt: "browser", tts: false, ttsProvider: "browser",
  flagHandling: "redirect", pictureCheck: true, wordAdditions: [], allowedPhrases: [],
  buildsPerDay: 30, hoursStart: "08:00", hoursEnd: "19:00",
};
export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  setupComplete: false, pinHash: null, builder: null, checker: null,
  moderation: "off", moderationOffAcknowledged: false,
  moderationThreshold: 0.2, retentionDays: 90, smtp: null,
};

const provider = z.enum(["openai", "anthropic", "google"]);
const modelChoice = z.strictObject({ provider, model: z.string().min(1) });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const GlobalPatch = z.strictObject({
  setupComplete: z.boolean(), pinHash: z.string().nullable(),
  builder: modelChoice.nullable(), checker: modelChoice.nullable(),
  moderation: z.enum(["openai", "google", "off"]), moderationOffAcknowledged: z.boolean(),
  moderationThreshold: z.number().min(0.05).max(0.5), retentionDays: z.number().int().min(1),
  smtp: z.strictObject({
    host: z.string(), port: z.number().int(), user: z.string(), pass: z.string(), from: z.string(), to: z.string(),
  }).nullable(),
}).partial();

const ChildPatch = z.strictObject({
  typing: z.boolean(), pictures: z.boolean(), voice: z.boolean(),
  stt: z.enum(["browser", "openai", "google"]), tts: z.boolean(), ttsProvider: z.enum(["browser", "openai", "google"]),
  flagHandling: z.enum(["redirect", "notify", "hold"]), pictureCheck: z.boolean(),
  wordAdditions: z.array(z.string()), allowedPhrases: z.array(z.string()),
  buildsPerDay: z.number().int().min(1).max(500), hoursStart: hhmm, hoursEnd: hhmm,
}).partial();

const mask = (key: string, v: unknown): unknown => {
  if (key === "pinHash") return v === null ? null : "***";
  if (key === "smtp" && v) return { ...(v as object), pass: "***" };
  return v;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function logChanges(audit: AuditWriter, oldS: object, patch: object, scope?: object) {
  for (const [key, nv] of Object.entries(patch)) {
    const ov = (oldS as Record<string, unknown>)[key];
    if (!same(ov, nv)) audit.logEvent("settings_change", { ...scope, key, old: mask(key, ov), new: mask(key, nv) });
  }
}

function anyChildNotifies(db: Db): boolean {
  const rows = db.prepare("SELECT settings FROM children").all() as { settings: string }[];
  return rows.some((r) => JSON.parse(r.settings).flagHandling === "notify");
}

export function getGlobal(db: Db): GlobalSettings {
  const out: Record<string, unknown> = { ...DEFAULT_GLOBAL_SETTINGS };
  for (const r of db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[])
    out[r.key] = JSON.parse(r.value);
  return out as GlobalSettings;
}

export function updateGlobal(db: Db, patch: Partial<GlobalSettings>, audit: AuditWriter): void {
  const p = GlobalPatch.parse(patch);
  const old = getGlobal(db);
  if ("smtp" in p && !p.smtp && anyChildNotifies(db)) throw new Error("smtp is needed while a child uses 'notify'");
  const put = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  // write and audit atomically: if logging throws, the change rolls back
  db.transaction(() => {
    for (const [k, v] of Object.entries(p)) put.run(k, JSON.stringify(v));
    logChanges(audit, old, p);
  })();
}

type ChildRow = { id: number; name: string; avatar: string; age: number; settings: string };

export function getChild(db: Db, childId: number) {
  const r = db.prepare("SELECT * FROM children WHERE id = ?").get(childId) as ChildRow | undefined;
  if (!r) return null;
  const settings: ChildSettings = { ...DEFAULT_CHILD_SETTINGS, ...JSON.parse(r.settings) };
  return { id: r.id, name: r.name, avatar: r.avatar, age: r.age, settings };
}

export function createChild(db: Db, c: { name: string; avatar: string; age: number }): number {
  const r = db.prepare("INSERT INTO children (name, avatar, age, settings) VALUES (?, ?, ?, '{}')").run(c.name, c.avatar, c.age);
  return Number(r.lastInsertRowid);
}

export function updateChild(db: Db, childId: number, patch: Partial<ChildSettings>, audit: AuditWriter): void {
  const p = ChildPatch.parse(patch);
  if (p.flagHandling === "notify" && !getGlobal(db).smtp)
    throw new Error("flagHandling 'notify' requires smtp settings");
  const child = getChild(db, childId);
  if (!child) throw new Error(`no such child ${childId}`);
  const next = { ...child.settings, ...p };
  db.transaction(() => {
    db.prepare("UPDATE children SET settings = ? WHERE id = ?").run(JSON.stringify(next), childId);
    logChanges(audit, child.settings, p, { childId });
  })();
}
