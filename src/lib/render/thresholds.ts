// The size ladder from ARCHITECTURE §6.2, in one module so changing a cutoff is a
// one-line change.
//
// MEASUREMENTS ARE OUTSTANDING. Every number below is the architecture's stated
// starting point, not a measured one — the document says so itself. M5 records Shiki's
// wall clock and output size at 200 / 2 000 / 20 000 / 100 000 lines in the README and
// revises HIGHLIGHT_LINES against real hardware. Until then treat it as provisional.

/** Above this a body moves from a Postgres `text` column to an object store. Chosen
 *  above the 99th-percentile paste [assumed], and roughly where a single-row fetch
 *  stops being free, so the common case stays transactional with its metadata. */
export const OBJECT_STORAGE_BYTES = 512 * 1024;

/** Highlighting needs the body under BOTH of these. The line count is the binding one:
 *  the constraint is DOM node count in the browser, not CPU on the server. */
export const HIGHLIGHT_BYTES = 256 * 1024;
export const HIGHLIGHT_LINES = 2_000;

/** Above this only the first TRUNCATE_LINES are rendered, with the real total named in
 *  a banner. Telling the user is part of the feature. */
export const TRUNCATE_BYTES = 2 * 1024 * 1024;
export const TRUNCATE_LINES = 500;

/** Hard caps. Over these is a file, not a snippet — 413, with a pointer at project 03. */
export const MAX_BYTES_WEB = 10 * 1024 * 1024;
export const MAX_BYTES_CLI = 25 * 1024 * 1024;

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
