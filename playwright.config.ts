import { defineConfig, devices } from "@playwright/test";

// 3025 = project 25, not the shared default. Port 3000 is routinely occupied by
// another project in this workspace, and `reuseExistingServer` on a shared port
// silently runs the whole e2e suite against whatever app answered.
const PORT = 3025;

export default defineConfig({
  testDir: "./tests/e2e",
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
