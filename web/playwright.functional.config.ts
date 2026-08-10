import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e-functional/paths";

/**
 * Functional harness: drives the REAL application (API + DB + worker) in a
 * browser. Kept separate from playwright.config.ts (the demo/tour suite). The
 * backend (migrated DB + worker + web server, all on the deterministic
 * provider) is started in global-setup so the tests only drive the browser.
 */
export default defineConfig({
  testDir: "./e2e-functional",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 60_000,
  globalSetup: "./e2e-functional/global-setup.ts",
  globalTeardown: "./e2e-functional/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
});
