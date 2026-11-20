// Loaded before anything reads `process.env`. Playwright does not read `.env` on its own,
// and without this the e2e fixtures' `pg` client fell back to localhost:5432 and failed
// with ECONNREFUSED — six tests failing for a reason that had nothing to do with the app.
import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

// 3025 = project 25, not the shared default. Port 3000 is routinely occupied by
// another project in this workspace, and `reuseExistingServer` on a shared port
// silently runs the whole e2e suite against whatever app answered.
const PORT = 3025;

export default defineConfig({
  testDir: "./tests/e2e",
  // `.e2e.ts`, which is what the plan names these files. Playwright's default `testMatch`
  // only picks up `.spec.` and `.test.`, so without this the suite reported "No tests
  // found" and exited 1 — a green-looking run that had executed nothing.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  // Phone widths are a required surface, not an afterthought: the prototype
  // designs ux-55 – ux-58 for them.
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // 1280 EXACTLY, because that is where the landing page broke and nothing noticed.
    // `Desktop Chrome` is 1280x720, so the suite was already running there — but axe does
    // not flag a figure wrapping mid-number, and nothing else measured layout. This project
    // adds the one assertion that does, at the width where two-column grids hand over.
    {
      name: "laptop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: `http://127.0.0.1:${PORT}`,
    // Never reuse: the command rebuilds, and a leftover server would serve a stale
    // build. That bug cost two detours during M0 and this suite guards N5, where a
    // silent pass is the worst outcome.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
