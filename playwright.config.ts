import { defineConfig, devices } from "@playwright/test";

// Runs against an already-running `netlify dev` (frontend + functions together —
// plain `vite` doesn't serve netlify/functions/*, and auth/integration calls need
// those). Start it yourself before `npm run test:e2e`; this config deliberately
// has no webServer block so it never spins up a second instance on top of yours.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  // Playwright wipes outputDir entirely before each run — kept out of
  // test-results/ (where every other phase's JSON results live) so re-running
  // the E2E suite doesn't delete the rest of the test report's raw data.
  outputDir: ".playwright-artifacts",
  reporter: "list",
  use: {
    baseURL: process.env.ORBIT_BASE_URL || "http://localhost:8888",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
