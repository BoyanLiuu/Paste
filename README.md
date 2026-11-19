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

The numbers behind `src/lib/render/thresholds.ts`. **Reproduce them with
`pnpm measure:thresholds`** — the script is committed, and every figure below is its
output on an Apple-silicon laptop with Shiki 4.6, the CSS-variables theme and the
style-to-class transformer.

The script exists because the M5 numbers did not survive contact with a re-measurement.
They recorded an output without its input, so there was no way to tell a regression from a
different test body — and they were 2–3× off. **A measurement you cannot re-run is a claim,
not evidence.**

### Shiki, highlighting at save time

Cold start, the first highlight in a process: **70 ms**. That is WASM and grammar warm-up,
paid once. A per-request highlighter would pay it on every view.

| lines   | language   | wall clock | HTML    | bytes/line |
| ------- | ---------- | ---------- | ------- | ---------- |
| 200     | TypeScript | 34 ms      | 118 KB  | 604        |
| 2 000   | TypeScript | 309 ms     | 1.2 MB  | 604        |
| 20 000  | TypeScript | 2 747 ms   | 11.5 MB | 604        |
| 100 000 | TypeScript | 13 415 ms  | 57.6 MB | 604        |
| 200     | plain text | 0 ms       | 21 KB   | 105        |
| 2 000   | plain text | 8 ms       | 205 KB  | 105        |
| 20 000  | plain text | 35 ms      | 2.0 MB  | 105        |
| 100 000 | plain text | 190 ms     | 10.0 MB | 105        |

The TypeScript rows repeat one deliberately dense line — a generic, a string literal and a
trailing comment. As a control, the largest TypeScript file in this repo measured as
itself: **342 lines, 57 KB of markup, 171 bytes/line, 110 ms.**

**What these numbers settled, and what they changed.**

_The DOM is the constraint, and a line count cannot express it._ This is the finding that
changed the code. The same language, the same line count, measured 171 bytes/line as real
code and 604 as dense code — a 3.5× spread, so 2 000 lines is anywhere between 348 KB and
1.2 MB of HTML. §6.2 accepted 688 KB. No choice of line count is right for both ends of
that range, because the quantity being bounded is not a function of the input the gate can
see. So `MAX_RENDER_BYTES` caps the **markup**, checked after rendering by both writers,
and the line and byte gates were demoted to what they honestly are: a cheap refusal to
start work that would be discarded anyway.

_Checking the output is affordable only because rendering already happens at save time._
The cost of a refused render is one wasted highlight on a save that still succeeded, and
the reader falls back to escaped text with a banner — a path that already existed for a
missing render. On a read path this check would be impossible, which is the same argument
§6.2 makes for rendering once.

_Cost is superlinear past the cutoff._ 200 → 2 000 lines is 9× the work for 10× the lines;
2 000 → 20 000 is 9× again; 20 000 → 100 000 is 4.9× for 5× the lines but 13.4 seconds in
absolute terms. The 2 000-line rung is where highlighting stops being bookkeeping and
becomes a visible pause on a save, which is why the gates stay where they are even though
they are no longer the real limit.

### The scanner

| body             | rules after keyword prefilter | wall clock |
| ---------------- | ----------------------------- | ---------- |
| 256 KB of code   | a handful                     | ~22 ms     |
| 256 KB of filler | a handful                     | ~33 ms     |

Comfortably inside §6.1's 150 ms budget. The keyword prefilter is what buys it: most
bodies never run most of the 220 compiled rules.
