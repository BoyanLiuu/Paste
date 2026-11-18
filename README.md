# Paste

A snippet-sharing tool. Paste text, get a permanent link; the bytes behind that link are
never rewritten, only superseded or destroyed. Pastes are scanned for credentials before
they are stored, so a leaked key never gets a URL in the first place.

The design is in `docs/project-idea/25-paste-snippet-sharing/ARCHITECTURE.md`, and the
build order in `IMPLEMENTATION_PLAN.md` beside it. Read `AGENTS.md` before changing
anything — several things here are deliberately not the Next.js defaults.

## Getting Started

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:3025** — not 3000, which another project in this workspace
occupies. Port 3000 answering does not mean it answered as this app.

`pnpm dev` regenerates three artifacts first (the Prisma client, the fixture renders, the
compiled secret rules). None are committed, so a fresh clone needs the one command rather
than a documented sequence.

Run `pnpm dev:raw` alongside it to serve `/raw` and `/dl` from a second origin on 3026,
which is how the cross-origin behaviour in ARCHITECTURE §6.5 gets exercised locally
instead of on deploy day.

### The database

Everything through M5 runs on fixtures and needs no database. From M6 on:

```bash
cp .env.example .env     # then fill in the two connection strings
pnpm db:deploy           # apply migrations
pnpm db:status           # confirm
```

**`pnpm db:deploy` only.** Never `prisma migrate dev` and never `migrate reset`: this
project shares one Supabase project with the workspace's other apps, and dev and
production share the `paste` schema inside it. Both commands can drop data that is live.
There is no staging copy to rehearse against, so a destructive migration needs a manual
backup first.

Two details that are easy to get wrong, both explained in `.env.example`:

- The connection strings go in `.env`, **not** `.env.local` — the Prisma CLI does not read
  `.env.local`, and splitting them gives you a working app with a failing migration.
- `DIRECT_URL` carries `?schema=paste` and `DATABASE_URL` does not. That parameter decides
  which schema holds `_prisma_migrations`; without it, this app and Nexdo share one ledger
  and each reads the other's migrations as missing.

`immutability.spec.ts` and `rls.spec.ts` run against the real database inside a
transaction that is always rolled back. Without `.env` they skip and print why.

## Measured thresholds

The numbers behind `src/lib/render/thresholds.ts`. Taken at M5 on an Apple-silicon
laptop with `pnpm tsx`, Shiki 4.6, the CSS-variables theme and the style-to-class
transformer. Re-measure on real hardware before trusting them elsewhere — the
architecture's own instruction, and the reason these are written down rather than
asserted.

### Shiki, highlighting at save time

| lines   | language   | wall clock | HTML   | bytes/line |
| ------- | ---------- | ---------- | ------ | ---------- |
| 200     | TypeScript | 92 ms      | 70 KB  | 353        |
| 2 000   | TypeScript | 96 ms      | 688 KB | 344        |
| 20 000  | TypeScript | 826 ms     | 6.9 MB | 343        |
| 100 000 | TypeScript | 3 689 ms   | 34 MB  | 343        |
| 200     | plain text | 1 ms       | 12 KB  | 61         |
| 2 000   | plain text | 2 ms       | 120 KB | 60         |
| 20 000  | plain text | 19 ms      | 1.2 MB | 60         |
| 100 000 | plain text | 92 ms      | 6.0 MB | 60         |

**Three things these numbers settle.**

_The 2 000-line cutoff holds, but not for the reason the design gave._ Wall clock at
2 000 lines is 96 ms, which would be perfectly affordable inside a save request. What
is not affordable is **688 KB of markup** — that is the browser's problem, and it
confirms ARCHITECTURE §6.2's claim that the DOM rather than the CPU sets the limit. At
20 000 lines it is 6.9 MB and 826 ms, past both.

_Shiki has roughly 90 ms of fixed cost._ 200 lines and 2 000 lines take almost the same
wall clock, so nearly all of it is WASM and grammar warm-up rather than per-line work.
A per-request highlighter would pay that on every view; rendering once at save pays it
once per revision. That is the §6.2 argument, measured.

_Cost tracks grammar, not bytes._ TypeScript costs 343 bytes and plain text 60 bytes per
line — a 5.7× spread on identical line counts. A byte-based cutoff would be wrong for
one of them whichever value it took, which is why the threshold counts lines.

### The scanner

| body             | rules after keyword prefilter | wall clock |
| ---------------- | ----------------------------- | ---------- |
| 256 KB of code   | a handful                     | ~22 ms     |
| 256 KB of filler | a handful                     | ~33 ms     |

Comfortably inside §6.1's 150 ms budget. The keyword prefilter is what buys it: most
bodies never run most of the 220 compiled rules.
