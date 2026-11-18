This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Measured thresholds

The numbers behind `src/lib/render/thresholds.ts`. Taken at M5 on an Apple-silicon
laptop with `pnpm tsx`, Shiki 4.6, the CSS-variables theme and the style-to-class
transformer. Re-measure on real hardware before trusting them elsewhere — the
architecture's own instruction, and the reason these are written down rather than
asserted.

### Shiki, highlighting at save time

| lines | language | wall clock | HTML | bytes/line |
|---|---|---|---|---|
| 200 | TypeScript | 92 ms | 70 KB | 353 |
| 2 000 | TypeScript | 96 ms | 688 KB | 344 |
| 20 000 | TypeScript | 826 ms | 6.9 MB | 343 |
| 100 000 | TypeScript | 3 689 ms | 34 MB | 343 |
| 200 | plain text | 1 ms | 12 KB | 61 |
| 2 000 | plain text | 2 ms | 120 KB | 60 |
| 20 000 | plain text | 19 ms | 1.2 MB | 60 |
| 100 000 | plain text | 92 ms | 6.0 MB | 60 |

**Three things these numbers settle.**

*The 2 000-line cutoff holds, but not for the reason the design gave.* Wall clock at
2 000 lines is 96 ms, which would be perfectly affordable inside a save request. What
is not affordable is **688 KB of markup** — that is the browser's problem, and it
confirms ARCHITECTURE §6.2's claim that the DOM rather than the CPU sets the limit. At
20 000 lines it is 6.9 MB and 826 ms, past both.

*Shiki has roughly 90 ms of fixed cost.* 200 lines and 2 000 lines take almost the same
wall clock, so nearly all of it is WASM and grammar warm-up rather than per-line work.
A per-request highlighter would pay that on every view; rendering once at save pays it
once per revision. That is the §6.2 argument, measured.

*Cost tracks grammar, not bytes.* TypeScript costs 343 bytes and plain text 60 bytes per
line — a 5.7× spread on identical line counts. A byte-based cutoff would be wrong for
one of them whichever value it took, which is why the threshold counts lines.

### The scanner

| body | rules after keyword prefilter | wall clock |
|---|---|---|
| 256 KB of code | a handful | ~22 ms |
| 256 KB of filler | a handful | ~33 ms |

Comfortably inside §6.1's 150 ms budget. The keyword prefilter is what buys it: most
bodies never run most of the 220 compiled rules.
