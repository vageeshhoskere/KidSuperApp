import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS children (id INTEGER PRIMARY KEY, name TEXT, avatar TEXT, age INTEGER, settings TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS creations (id INTEGER PRIMARY KEY, child_id INTEGER, title TEXT, scene TEXT, thumbnail TEXT, is_new INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS audit_requests (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, child_id INTEGER NOT NULL,
  input_mode TEXT NOT NULL, input_text TEXT NOT NULL,
  layer1 TEXT NOT NULL, layer2 TEXT NOT NULL, layer3 TEXT NOT NULL,
  intent TEXT, summary TEXT, builder TEXT, checker TEXT,
  output_text TEXT, picture_check TEXT,
  outcome TEXT NOT NULL, error_detail TEXT, raw TEXT NOT NULL, scene TEXT, parent_request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_requests_created ON audit_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_requests_child ON audit_requests(child_id, created_at);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, type TEXT NOT NULL,
  related_request_id TEXT, detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
`;

export function openDb(path: string): Db {
  const db = new Database(path);
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
