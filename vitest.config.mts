import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright owns tests/e2e; vitest would try to run those as unit tests.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],

    // CONNECTION BUDGET, not a performance setting.
    //
    // Vitest runs one worker process per test file, and each one that touches the
    // database builds its own Prisma pool. Supabase's SESSION pooler allows 15 clients
    // total, so ~14 database-touching files at the default pool size blew straight past
    // it: `(EMAXCONNSESSION) max clients reached in session mode` on 55 queries, which
    // surfaced as unrelated-looking failures all over the suite — immutability tests,
    // teardown, the create path — none of which were broken.
    //
    // This is downstream of the compromise recorded in `.env`: port 6543 is blocked on
    // this network, so both URLs point at the session pooler. The transaction pooler the
    // app actually deploys against has a far higher limit and would not bite here.
    //
    // 4 workers × 1 connection = 4, comfortably inside 15 with room for the raw `pg`
    // clients the rollback harness opens alongside.
    //
    // `maxWorkers`, not `poolOptions.forks.maxForks`. The first attempt used the latter,
    // which Vitest 4 removed — it was accepted silently with only a deprecation line in
    // the output, so the cap did nothing and the suite passed on `DATABASE_POOL_MAX`
    // alone. A config key that is ignored rather than rejected is the worst kind to get
    // wrong, because the thing it was protecting still looks protected.
    // 5 s is vitest's default and is written for unit tests. Most of this suite talks to a
    // hosted Postgres — a single create exercises 220 scanner rules, a Shiki render and
    // half a dozen round trips — and the files that call `vi.resetModules()` pay the
    // highlighter's ~90 ms WASM warm-up again afterwards. `id-retry.spec.ts` began timing
    // out intermittently at 5 s; it was never hanging, just slower than the default
    // allows.
    testTimeout: 20_000,
    hookTimeout: 20_000,

    maxWorkers: 4,

    // FILES RUN ONE AT A TIME, and this is a correctness setting rather than a tuning one.
    //
    // The sweeper is a global mutating job: phase A expires every past-due paste in the
    // database, which is what a cron job should do. Vitest runs one worker per file in
    // parallel, so the sweeper's tests raced every other file that seeds a past-due paste
    // to observe something about it — the sweeper expired other tests' fixtures, and its
    // own summary counters (`expired`, and `more`, which reports whether ANY past-due row
    // remains anywhere) counted rows it had never been told about.
    //
    // Scoping assertions to one owner fixes most of that and was done where it applies.
    // It cannot fix `more`, which is global by definition and is the flag that
    // distinguishes "finished" from "ran out of time" — the thing most worth testing
    // about a resumable job.
    //
    // Cost: the suite goes from ~10 s to ~38 s. Worth it. A suite that fails one run in
    // five teaches everyone to re-run it, and then it is not a suite.
    fileParallelism: false,

    env: {
      DATABASE_POOL_MAX: "1",
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    // The service layer imports `server-only`, which throws by design outside a React
    // Server Component environment. Its exports map sends this condition to an empty
    // module, so the guard still protects the app build while the unit suite can import
    // the same files. Stubbing the package instead would hide a real misuse.
    conditions: ["react-server"],
  },
  // A KNOWN GAP, recorded where someone would hit it: component tests cannot run.
  //
  // `server-only` and `react-dom/client` want OPPOSITE resolve conditions. The service
  // layer needs `react-server` — that is what routes `server-only` to an empty module and
  // lets the suite import the files the app guards. But `react-dom/client` also has a
  // `react-server` entry and it THROWS, so `@testing-library/react` cannot load and
  // nothing can be rendered in a test.
  //
  // Four ways out were tried and none worked: a `projects` entry with `conditions: []`
  // (read as "no override"), with the web conditions spelled out, with `extends: true`
  // (Vite MERGES condition arrays rather than replacing them, so `react-server` survives),
  // and as a standalone project repeating the plugin and alias.
  //
  // The cost is real and was paid once already: the save receipt's `saved` branch stayed
  // the thinnest of its seven states for five milestones, because an e2e run cannot reach
  // it without a Clerk session and a component test could not load. Rules worth holding
  // get extracted to pure modules instead — see `src/lib/paste-url.ts`.
  ssr: {
    resolve: {
      // The same condition again, for files that opt into `@vitest-environment node`.
      //
      // `resolve.conditions` above only covers the web/jsdom graph, so a node-environment
      // spec resolved `server-only` to its default export and threw on import. Which
      // forced every Prisma test into jsdom — where Shiki's oniguruma WASM cannot load,
      // so stage 8's render failed silently and the create path's render was never
      // actually exercised by anything. Two unrelated-looking problems, one cause.
      conditions: ["react-server"],
    },
  },
});
