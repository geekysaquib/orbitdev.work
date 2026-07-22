import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs against an already-running `netlify dev` (frontend + functions together —
// plain `vite` doesn't serve netlify/functions/*, and auth/integration calls need
// those). Start it yourself before `npm run test:e2e`; this config deliberately
// has no webServer block so it never spins up a second instance on top of yours.
// netlify-cli runs its own chokidar file watcher over the whole project tree
// (separate from Vite's) and has been observed to crash outright — "EPERM:
// operation not permitted, watch '...jpeg'" — when Playwright writes trace/
// screenshot files fast inside the project directory. Vite's own watcher can
// be told to ignore a folder (see vite.config.ts), but netlify-cli's cannot,
// so outputDir goes fully outside the repo instead of just outside
// test-results/ (which also avoids Playwright wiping the other phases' JSON
// results on every run, since it clears its outputDir before each run).
const PLAYWRIGHT_OUTPUT_DIR = process.env.PLAYWRIGHT_OUTPUT_DIR || join(tmpdir(), "orbit-playwright-artifacts");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // `netlify dev` on this machine has been observed to drop connections for a
  // few seconds under sustained load from a full suite run (ERR_CONNECTION_
  // REFUSED), unrelated to app code — one retry absorbs that transient blip
  // instead of failing tests that would otherwise pass.
  retries: 1,
  outputDir: PLAYWRIGHT_OUTPUT_DIR,
  reporter: "list",
  use: {
    baseURL: process.env.ORBIT_BASE_URL || "http://localhost:8888",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
