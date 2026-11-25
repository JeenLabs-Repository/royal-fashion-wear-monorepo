import { defineConfig, devices } from "@playwright/test"

// Start the vendor portal when needed. The backend and storefront must already
// be running for specs that call them (see docs/testing/playwright.md).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",
  // The vendor portal dev server is started for the portal browser specs when it
  // is not running already. The backend must be running (pnpm backend:dev) first.
  webServer: [
    {
      command: "pnpm -C apps/vendor-portal dev",
      url: process.env.E2E_PORTAL_URL ?? "http://localhost:5173/vendor-portal/",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL: process.env.E2E_STOREFRONT_URL ?? "http://localhost:8000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 5"] } },
  ],
})
