import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readKeys, writeKey, maskKey } from "../../server/keys";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "keys-"));

describe("keys", () => {
  it("readKeys on missing file is {}", () => expect(readKeys(tmp())).toEqual({}));
  it("writeKey creates file with mode 0600 and round-trips", () => {
    const d = tmp();
    writeKey(d, "openai", "sk-1");
    writeKey(d, "google", "g-2");
    expect(fs.statSync(path.join(d, "keys.json")).mode & 0o777).toBe(0o600);
    expect(readKeys(d)).toEqual({ openai: "sk-1", google: "g-2" });
    writeKey(d, "openai", null);
    expect(readKeys(d)).toEqual({ google: "g-2" });
    expect(fs.readdirSync(d)).toEqual(["keys.json"]);
  });
  it("maskKey", () => expect(maskKey("sk-abcdef1234")).toBe("••••1234"));
});
