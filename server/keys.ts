import fs from "node:fs";
import path from "node:path";

export type Provider = "openai" | "anthropic" | "google";
export type Keys = Partial<Record<Provider, string>>;

const file = (dir: string) => path.join(dir, "keys.json");

export function readKeys(dir: string): Keys {
  try {
    return JSON.parse(fs.readFileSync(file(dir), "utf8")) as Keys;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

export function writeKey(dir: string, provider: Provider, key: string | null): void {
  const keys = readKeys(dir);
  if (key === null) delete keys[provider];
  else keys[provider] = key;
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file(dir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(keys), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // mode is masked by umask on create; be explicit
  fs.renameSync(tmp, file(dir));
}

export const maskKey = (key: string): string => "••••" + key.slice(-4);
