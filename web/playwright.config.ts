import { defineConfig, devices } from "@playwright/test";

// Deterministic e2e: no live model, Slack, or external APIs. The app runs on
// 3001 with fictional data, so these tests are stable in CI.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  // Test the production build: routes are precompiled, so there is no dev-compile
  // lag or HMR noise, which makes the suite deterministic.
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
