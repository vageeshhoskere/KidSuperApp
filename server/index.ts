import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "./app";
import { openDb } from "./db";
import { purgeOlderThan } from "./audit";
import { getGlobal } from "./settings";

const dataDir = process.env.DATA_DIR ?? "./data";
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = openDb(path.join(dataDir, "app.db"));

// buildApp builds the registry from keys.json and rebuilds it after every key change
const app = buildApp({ db, dataDir });

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
const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address ?? "localhost";
console.log(`Open http://${lan}:${port} on the child's device. Parent area: /parent`);
