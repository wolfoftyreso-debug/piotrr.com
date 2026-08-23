import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * Which Chromium: an explicit CHROMIUM_PATH wins; the pre-installed
 * sandbox browser is used when it exists; otherwise (CI) undefined lets
 * Playwright resolve the browser `npx playwright install` fetched. The
 * old hardcoded fallback made CI impossible — the path only exists in
 * the dev sandbox image.
 */
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath =
  process.env.CHROMIUM_PATH ??
  (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

/**
 * E2e over the three critical flows (Section 5/M4):
 *   1. verify a supplier   2. publish a profile   3. RFQ → accepted offer
 * Requires a running server (npm start) and a migrated+seeded database.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 1,
  workers: 1, // flows share the database — run serially
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    locale: "en-GB",
    launchOptions: { executablePath },
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm start -- --port 3100",
        url: "http://localhost:3100/api/healthz",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
