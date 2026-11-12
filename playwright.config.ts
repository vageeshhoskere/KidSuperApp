import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kid3d-e2e-"));

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://localhost:3100",
    trace: "off",
    // software WebGL so renderSnapshot works in headless Chromium
    launchOptions: { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: `npm run build && FAKE_PROVIDERS=1 DATA_DIR=${dataDir} PORT=3100 npx tsx server/index.ts`,
    url: "http://localhost:3100/api/parent/status",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
