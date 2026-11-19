<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Paste — project rules

The design is `docs/project-idea/25-paste-snippet-sharing/ARCHITECTURE.md`; the build order
is `IMPLEMENTATION_PLAN.md` beside it. Both are authoritative. Appendix H records what has
already gone wrong here — read it before assuming a surprising thing is a bug.

### Things that destroy data

- **`pnpm db:deploy` only.** Never `prisma migrate dev`, never `migrate reset`. One
  Supabase project is shared with the workspace's other apps, and dev and production share
  the `paste` schema inside it. Both commands can drop live data, and there is no staging
  copy. Seeds are additive — `ON CONFLICT DO NOTHING`, never `TRUNCATE`.
- Tests that touch the database go through `withRollback` in
  `src/lib/server/db-test-harness.ts`. A committed test row is a row in live data.
- `DIRECT_URL` keeps `?schema=paste`. Removing it points `_prisma_migrations` at `public`,
  where Nexdo's ledger already lives, and the two apps then invalidate each other.

### Things the sweeper must keep doing

- **Delete the object before nulling the `storage_key`.** Reversed, a crash leaves an
  object in the bucket with nothing pointing at it, and Supabase Storage has no lifecycle
  rules — nothing will ever clean it up. `sweep.spec.ts` asserts the key survives a failed
  delete.
- **Delete the render row too.** A purged paste that still holds its rendered HTML has
  been hidden, not purged.
- **Every step idempotent.** A killed invocation leaves a leased row that the next tick
  re-claims, so each step runs again over work that is already done. Notably: do not
  rewrite `purged_at` if it is already set, or the only record of when the bytes went is
  replaced by the retry time.
- **A revision never migrates between inline text and an object.** The M6 trigger permits
  exactly one body mutation — the purge — so storage is decided once, at insert, from
  `byte_size`. An inline-to-object `UPDATE` raises.
- `orphans.sql` is **report-only** and deliberately not scheduled. A growing list is a bug
  in the sweeper's ordering, not untidy storage; automatic deletion would hide the cause.

### Things that break the security model

- **The scanner's rules must stay sorted by tier** (`src/lib/secrets/scan.ts`). The first
  rule to match a span claims it, so compiled order lets generic tier-2 rules steal spans
  from tier-1 ones — which turns a hard block into an overridable warning.
- **Never commit a credential-shaped literal.** Samples are assembled at runtime;
  `no-committed-secrets.spec.ts` enforces it and GitHub push protection will reject the
  push anyway. Do not allowlist — fix the generator.
- **The view page ships exactly one client script.** `view-route-imports.spec.ts` walks the
  module graph and fails on a second. Adding a client component to that route, even a
  shadcn one, breaks N5 — a shadcn `separator.tsx` already did once; it is now an `<hr>`.
- Highlighting is server-side only, and the HTML is stored. Shiki must never reach the
  browser bundle, and `no-inline-styles.spec.ts` guards the `style-src` claim that the
  strict CSP rests on.
- `src/lib/server/prisma.ts` imports `server-only`. That guard is the thing keeping
  `DATABASE_URL` out of a client payload; do not remove it to make an import work.
- **Never render on a read path.** N2 is "0 highlighter invocations on the read path". A
  missing render is answered by the escaped fallback plus a banner; `POST /api/renders`
  backfills it from cron. A lazy `if (missing) highlight()` in `getRender` is the one
  change that breaks N2, and it looks like a bug fix.
- **The 410 and the 404 on `/p/:id` come from `src/proxy.ts`, not the page.** Next gives a
  page no status API beyond `notFound()`, and the route is partially prerendered so the
  shell answers 200 first. The liveness rule therefore exists twice — `livenessOf` for
  rendering, `pasteLiveness` for the status — and `expiry-on-read.spec.ts` asserts they
  agree. Change one, change both.

### Conventions that are deliberate

- **Port 3025**, and 3026 for the raw origin. Not 3000 — another project holds it, and a
  200 from 3000 is not evidence this app answered.
- Generated artifacts are **gitignored and regenerated** by `build`, `test`, `typecheck`
  and `dev`: `src/generated/`, `src/lib/fixtures/renders.generated.ts`,
  `src/lib/secrets/rules.generated.ts`, `src/app/shiki-tokens.generated.css`. Do not commit
  them; do not hand-edit them.
- Fixtures use **relative** dates (offsets from `NOW`). Absolute dates rotted once and made
  designed screens unreachable; `liveness.spec.ts` now asserts every designed state still
  resolves to the state it was designed for.
- Prisma is **pinned** to an exact version. Its `latest` tag has pointed at a prerelease.
- pnpm build scripts are allowlisted in `pnpm-workspace.yaml` under `allowBuilds`. The key
  has moved twice across pnpm versions; a missing entry breaks the deploy, not the install.
- A test must name the bug it catches, in a comment, or it should not exist.
- **Test files run one at a time** (`fileParallelism: false`). The sweeper is a global
  mutating job, so it raced every other file that seeds a past-due paste. Re-enabling
  parallelism brings back a one-in-five flake. The suite takes ~38 s; that is the price.
- **Never read configuration at module scope.** `const BUDGET = Number(process.env.X)`
  freezes the value at whichever cold start imported the module, so changing the variable
  does nothing — and a test that sets it after the import silently gets the default. Read
  env inside the handler.
- **The test suite has a connection budget.** Supabase's session pooler allows 15 clients
  and vitest runs a worker per file, so `maxWorkers: 4` and `DATABASE_POOL_MAX=1` live in
  `vitest.config.mts`. Raising either brings back `(EMAXCONNSESSION) max clients reached`,
  which presents as unrelated logic failures across the whole suite.
- Database tests either roll back (`db-test-harness.ts`) or own a `t-<random>` user and
  delete by its id (`create-test-harness.ts`). Never a bare `DELETE`, never `TRUNCATE`:
  dev and production share this schema.
- **Never build a Prisma `where` with object spreads.** Use an `AND` array. Three
  conditions in `listPastes` contribute an `OR` — liveness, search, keyset seek — and a
  spread silently keeps only the last, which already shipped a list of expired pastes.
- Seed test pastes with `seedPastes`, which uses the real `newPasteId()`. Ids built from a
  uuid slice contain `0`, which `isPasteId` rejects — the app would never issue them.
