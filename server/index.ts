import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "./app";
import { lanUrls } from "./http";
import { openDb, restrictDataPerms } from "./db";
import { purgeOlderThan } from "./audit";
import { getGlobal } from "./settings";
import { makeFakeProvider } from "./providers/fake";
import { SceneSchema } from "../shared/scene";
import { fakeProvidersRefusal } from "./fake-guard";
import { readKeys } from "./keys";
import type { Registry } from "./providers/types";

/** Test-only: one scripted provider behind every id. No AI, no real safety checks. */
function fakeRegistry(): Registry {
  console.warn("WARNING: FAKE_PROVIDERS=1 — no real AI and no real safety checks");
  const cube = (y: number) => ({ shape: "cube", color: "red", position: [0, y, 0], size: [1, 1, 1], rotation: [0, 0, 0] });
  const fake = makeFakeProvider({
    json: (o) => o.schema === SceneSchema
      ? { title: "Red Tower", blocks: [cube(0.5), cube(1.5), cube(2.5)] }
      : { intent: "build a toy", summary: "toy build", verdict: "safe", categories: [], reason: "ok" },
    moderate: { violence: 0 },
  });
  return { get: () => fake };
}

const dataDir = process.env.DATA_DIR ?? "./data";
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const refusal = fakeProvidersRefusal(process.env.FAKE_PROVIDERS, readKeys(dataDir));
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
const db = openDb(path.join(dataDir, "app.db"));
restrictDataPerms(dataDir);

// Without an injected registry, buildApp builds it from keys.json and rebuilds it after every key change.
// An injected registry (FAKE_PROVIDERS) is never rebuilt.
const app = buildApp({ db, dataDir, ...(process.env.FAKE_PROVIDERS === "1" ? { registry: fakeRegistry(), fakeProviders: true } : {}) });

const purge = () => {
  try {
    purgeOlderThan(db, getGlobal(db).retentionDays, new Date());
  } catch (e) {
    app.log.error(e, "audit purge failed");
  }
};
purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();

const port = Number(process.env.PORT ?? 3000);
await app.listen({ host: "0.0.0.0", port });
console.log(`Open one of these on the child's device (parent area: add /parent):\n${lanUrls(os.networkInterfaces(), port).map((u) => `  ${u}`).join("\n")}`);
console.log("Keep this window open: closing it stops the app.");
