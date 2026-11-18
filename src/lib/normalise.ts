// Stage 4 of the create path (ARCHITECTURE §4): make the bytes canonical before anything
// measures, hashes, scans or stores them.
//
// Order matters here for the same reason it does in the outer pipeline. Every later stage
// reads what this one produced: the hash must cover the stored bytes and not the
// submitted ones, the scanner's offsets must point into the stored text, and `line_count`
// must match the number of line elements the renderer emits. Normalising after any of
// those would make them all describe a body that was never saved.

import { createHash } from "node:crypto";

/** U+FEFF. A real character mid-text; a byte-order mark only at position 0. */
const BOM = "﻿";

export interface Normalised {
  body: string;
  byteSize: number;
  lineCount: number;
  sha256: string;
}

/**
 * Canonicalise one submitted body.
 *
 * Returns the text to store, and the three measurements taken from it. Nothing here can
 * fail: a JSON string has already been decoded as UTF-8 by the time it arrives, so there
 * is no separate validation step to run — see `decodeUtf8` for the raw-bytes path.
 */
export function normalise(input: string): Normalised {
  let body = input;

  // 1. The BOM, and only a leading one. Editors on Windows add it, and left in place it
  //    becomes an invisible first character that breaks the detection ladder's
  //    first-line sniff (`#!/bin/sh` stops matching) and shows up as a stray glyph.
  if (body.startsWith(BOM)) body = body.slice(BOM.length);

  // 2. Line endings. CRLF and lone CR both become LF.
  //
  //    Not cosmetic: a CR left in place renders as a control character, and it lands
  //    inside the line content so `#L4` would highlight a line whose text ends in an
  //    invisible byte. Lone CR is handled too — old Mac files and, more often,
  //    hand-built strings.
  body = body.replace(/\r\n?/g, "\n");

  const byteSize = new TextEncoder().encode(body).length;

  return {
    body,
    byteSize,
    lineCount: countLines(body),
    // Over the stored bytes, so the tombstone's hash is checkable against what a reader
    // downloaded rather than against what they typed.
    sha256: createHash("sha256").update(body, "utf8").digest("hex"),
  };
}

/**
 * Lines, counted the way the renderer counts them.
 *
 * A trailing newline is a terminator, not an empty final line. The renderer strips it for
 * exactly this reason, and the two have to agree: when they disagreed, a 40-line paste
 * stored `line_count = 41` while the DOM held 40 line elements, so `#L41` was a link to
 * a line the range parser then refused.
 */
export function countLines(body: string): number {
  if (body === "") return 0;
  return body.replace(/\n$/, "").split("\n").length;
}

/**
 * Decode raw request bytes as UTF-8, or null if they are not valid UTF-8.
 *
 * The streamed `curl --data-binary` path needs this; the JSON path does not. `fatal`
 * is the whole point — without it, TextDecoder substitutes U+FFFD for every bad byte and
 * a binary upload would be stored as a wall of replacement characters instead of being
 * refused. Paste holds text (§1.1); accepting a JPEG as text is not leniency, it is
 * storing something nobody can use.
 */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
