import path from "node:path";
import readline from "node:readline/promises";
import { openDb } from "../server/db";
import { makeAuditWriter } from "../server/audit";
import { resetPin } from "../server/auth";

// Usage: npm run reset-pin [-- 123456]. Stop the server first so this has the data folder to itself.
const dataDir = process.env.DATA_DIR ?? "./data";
let pin = process.argv[2];
if (!pin) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  pin = (await rl.question("New 6-digit PIN: ")).trim();
  rl.close();
}
const db = openDb(path.join(dataDir, "app.db"));
try {
  resetPin(db, makeAuditWriter(db), pin);
  console.log("PIN changed");
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
