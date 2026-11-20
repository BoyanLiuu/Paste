# The test suite's database connections

`pnpm test` runs `DATABASE_POOL_MAX=1 vitest run --maxWorkers=6`, and both halves are
load-bearing rather than tuning.

## What went wrong

The four storage tests in `large-body.spec.ts` had been skipping since M9, gated on
`SUPABASE_SERVICE_ROLE_KEY`. Configuring that key on 20 Nov 2026 made them run — and the
suite started failing intermittently, in a **different file on each run**:
`plain-text-response.spec.ts` once, `id-retry.spec.ts` twice. Every failure was a 20 000 ms
timeout with no error from Postgres at all.

The storage tests were not the bug. They added just enough concurrent work to tip a
connection budget that was already over.

## The arithmetic

Vitest runs one worker per **file** by default. Each worker imports `prisma.ts`, which builds
its own pool of `DATABASE_POOL_MAX` connections — 3 by default. 49 files × 3 = up to **147
connections requested**.

`DATABASE_URL` points at Supabase's **session** pooler (port 5432), which holds one server
connection per client for that client's entire life. So 147 clients means 147 server
connections against a free-tier ceiling far below it. Tests then wait on a connection that is
never coming, and time out.

A moving failure is what a shared resource limit looks like from inside a test.

## Why not the other fixes

- **Raising the timeout** treats the symptom. The connection was not slow, it was unavailable;
  a longer wait turns a two-minute failure into a ten-minute one.
- **`--no-file-parallelism`** makes the suite serial. That is minutes of waiting to avoid a
  limit that a cap already fixes.
- **A `vitest.config.ts`** was the first attempt and it is a trap. With no config file the
  `@/…` aliases resolve and `server-only` resolves correctly; adding a config — even one that
  only sets `poolOptions` — replaced Vitest's defaults for `resolve.alias` AND
  `resolve.conditions`. First all 49 files failed to load with "Cannot find package
  '@/lib/ids'", then, with an alias declared, 35 failed on "This module cannot be imported
  from a Client Component module" and "history is not defined". Adding a config file here is
  not the additive change it appears to be. The CLI flag avoids the question entirely.

## If it comes back

The ceiling is `maxWorkers × DATABASE_POOL_MAX`. Lower either. The longer-term shape is to
split the suite in two — the database-backed files capped, the pure-logic ones unbounded,
since those would happily run 49 wide and cost nothing — which needs the config file this
note explains how to get wrong.
