import fs from "node:fs";
import path from "node:path";
import { openDb } from "../server/db";
import { makeAuditWriter } from "../server/audit";
import { readKeys } from "../server/keys";
import { makeRegistry } from "../server/providers/registry";
import { makeNotify } from "../server/notify";
import { getChild, getGlobal } from "../server/settings";
import { startBuild, type Deps } from "../server/pipeline";
import { evaluate, exitCode, type Entry, type Row } from "./redteam-eval";

const dataDir = process.env.DATA_DIR ?? "./data";
const keys = readKeys(dataDir);
if (!Object.keys(keys).length) {
  console.log("not run: no keys configured");
  process.exit(0);
}

const db = openDb(path.join(dataDir, "app.db"));
const g = getGlobal(db);
const row = db.prepare("SELECT id, settings FROM children ORDER BY id LIMIT 1").get() as { id: number; settings: string } | undefined;
if (!g.setupComplete || !row) {
  console.log("not run: setup is not finished (open /parent first)");
  process.exit(0);
}

const deps: Deps = {
  db, audit: makeAuditWriter(db), now: () => new Date(), registry: makeRegistry(keys),
  notify: makeNotify(() => g.smtp),
};
const prompts: Entry[] = JSON.parse(fs.readFileSync(new URL("./redteam-prompts.json", import.meta.url), "utf8"));

// The child settings are overridden for the run only: picture check off (nothing renders it here), no daily
// limit, open all day, flag handling "redirect" (never email). The original JSON is restored in `finally`,
// by a direct UPDATE so no settings_change audit events are written. A hard kill mid-run would leave the
// override in place; rerun the script, or reset those settings in /parent.
const override = { ...getChild(db, row.id)!.settings, pictureCheck: false, buildsPerDay: 500, hoursStart: "00:00", hoursEnd: "23:59", flagHandling: "redirect" };
const setSettings = (s: string) => db.prepare("UPDATE children SET settings = ? WHERE id = ?").run(s, row.id);

const rows: Row[] = [];
setSettings(JSON.stringify(override));
try {
  for (const e of prompts) {
    const r = await startBuild(deps, { childId: row.id, mode: "typed", text: e.prompt });
    rows.push(evaluate(e, r.status));
  }
} finally {
  setSettings(row.settings);
}

console.log("tag | expect | got | pass | prompt");
for (const r of rows) console.log(`${r.tag} | ${r.expect} | ${r.got} | ${r.pass ? "ok" : "FAIL"} | ${r.prompt}`);
console.log(`passed ${rows.filter((r) => r.pass).length}/${rows.length}`);
process.exit(exitCode(rows));
