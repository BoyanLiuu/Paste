// The size ladder from ARCHITECTURE §6.2, in one module so changing a cutoff is a
// one-line change.
//
// MEASURED AT M12, and `scripts/measure-thresholds.mts` reproduces every figure — which
// the M5 numbers could not, because they recorded an output without its input. Run
// `pnpm measure:thresholds`; the README quotes its output.
//
// WHAT THE MEASUREMENT CHANGED. §6.2 argues the browser's DOM rather than the server's CPU
// sets the limit, and that argument is right. The implementation of it was not: a line
// count cannot bound markup, because markup per line is a property of the CONTENT and not
// of the language. The same TypeScript gate produced
//
//   174 bytes/line   real code (`create-paste.ts`, measured as itself)
//   343 bytes/line   whatever M5 measured
//   604 bytes/line   a line carrying a generic, a string and a comment
//
// — a 3.5× spread, so 2 000 lines is anywhere from 348 KB to 1.2 MB of HTML. The design
// accepted 688 KB. Ordinary code sits well under it and dense code breaches it by 1.7×,
// and no choice of line count fixes that for both.
//
// So the real constraint is enforced on the real quantity: `MAX_RENDER_BYTES` caps the
// MARKUP, checked after rendering. The line and byte gates stay, demoted to what they
// honestly are — a cheap refusal to start work that is certain to be wasted.

/** Above this a body moves from a Postgres `text` column to an object store. Chosen
 *  above the 99th-percentile paste [assumed], and roughly where a single-row fetch
 *  stops being free, so the common case stays transactional with its metadata. */
export const OBJECT_STORAGE_BYTES = 512 * 1024;

/**
 * Highlighting needs the body under BOTH of these, and neither is the real constraint —
 * `MAX_RENDER_BYTES` is. These two bound the WORK: 20 000 lines costs 2.6 s and 11.5 MB of
 * markup that would be discarded by the output cap anyway, so there is no reason to spend
 * it. A body that passes here may still produce no stored render.
 *
 * Measured: at 2 000 lines, 278 ms and 348 KB – 1.2 MB of markup depending on density.
 * At 20 000, 2.6 s and 11.5 MB. The rung between them is where the cost stops being
 * once-per-revision bookkeeping and starts being a visible pause on a save.
 */
export const HIGHLIGHT_BYTES = 256 * 1024;
export const HIGHLIGHT_LINES = 2_000;

/**
 * The most stored markup a paste may have. The DOM budget §6.2 is actually about.
 *
 * CHECKED AFTER RENDERING, which is only affordable because §6.2 already renders at save
 * time and out of band: the bill is one discarded render on a save that already succeeded,
 * not latency on a read. Nothing else can work — the quantity being bounded does not exist
 * until Shiki has produced it, and every proxy for it (lines, source bytes) is wrong by up
 * to 3.5× in a direction that depends on the content.
 *
 * 768 KB because the design accepted 688 KB at the 2 000-line cutoff and that figure was
 * reasoned about rather than arbitrary; this rounds it up to a power-of-two boundary rather
 * than inventing a new budget. Real 2 000-line code measures 348 KB and fits with room to
 * spare. A body that misses the cap is served as escaped text with the banner the view page
 * already shows for a missing render — a path that exists, is designed, and is tested.
 */
export const MAX_RENDER_BYTES = 768 * 1024;

/**
 * Whether a finished render is small enough to keep.
 *
 * The one place this is decided, called by both writers — the create path's stage 8 and the
 * cron backfill. Two copies of a threshold is the drift Appendix H keeps recording.
 */
export function renderWorthStoring(html: string): boolean {
  return new TextEncoder().encode(html).length <= MAX_RENDER_BYTES;
}

/** Above this only the first TRUNCATE_LINES are rendered, with the real total named in
 *  a banner. Telling the user is part of the feature. */
export const TRUNCATE_BYTES = 2 * 1024 * 1024;
export const TRUNCATE_LINES = 500;

/**
 * The hard cap. Over it is a file, not a snippet — 413, with a pointer at project 03.
 *
 * The largest paste, for every caller.
 *
 * ONE CEILING. There were two — 10 MB from the browser form and 25 MB for the CLI — and
 * the split only existed because the CLI was how something that big got sent. With no CLI
 * there is no second caller to have a second limit for, and two numbers would mean the
 * same POST endpoint accepting or refusing the same body depending on a user-agent string.
 *
 * 25 MB rather than 10, because the designed truncated case is a 214,880-line kubectl log
 * of 20.1 MB (fixture `Kp2sM7aJ`). Keeping 10 would have made that screen describe
 * something nobody could create.
 *
 * The cost is real and accepted: a 25 MB form submission is a slow, memory-heavy request
 * from a browser, and `getRaw` buffers the whole body to serve it back (Appendix G).
 */
export const MAX_BYTES = 25 * 1024 * 1024;

export type RenderMode = "highlight" | "plain" | "truncated";

/** Which of the three rendering treatments a body gets. Callers should never compare
 *  against the constants directly; that is how two expressions of one rule drift. */
export function renderMode(byteSize: number, lineCount: number): RenderMode {
  if (byteSize > TRUNCATE_BYTES) return "truncated";
  if (byteSize > HIGHLIGHT_BYTES || lineCount > HIGHLIGHT_LINES) return "plain";
  return "highlight";
}

export function storageFor(byteSize: number): "postgres" | "object" {
  return byteSize > OBJECT_STORAGE_BYTES ? "object" : "postgres";
}
