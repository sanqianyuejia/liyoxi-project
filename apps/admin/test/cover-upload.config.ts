import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "cover-upload.spec.ts",
  workers: 1,
  forbidOnly: true,
  outputDir: "../dist/e2e-results/cover-upload",
  use: {
    baseURL: "http://127.0.0.1:5184",
    headless: true,
    channel: process.env.LYX_E2E_CHANNEL || undefined,
    screenshot: "on",
    trace: "retain-on-failure",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    command: "pnpm exec vite --host 127.0.0.1 --port 5184 --strictPort",
    url: "http://127.0.0.1:5184/test/fixtures/cover-upload.html",
    reuseExistingServer: false,
  },
});
