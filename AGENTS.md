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
- `src/lib/server/prisma.ts` throws if imported in the browser. That guard is the thing
  keeping `DATABASE_URL` out of a client payload; do not remove it to make an import work.

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
