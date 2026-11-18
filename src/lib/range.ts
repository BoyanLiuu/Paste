// Parsing and formatting `#L10-L20`.
//
// Pure, and separate from the client script so it can be tested without a DOM. The
// fragment is never sent to the server (§6.2) — this runs in the browser on load and
// on every click.

export interface LineRange {
  start: number;
  end: number;
}

/**
 * Reads a fragment into a clamped, ordered range, or null when it means nothing.
 *
 * Every malformed form has to produce null or a usable range rather than throwing,
 * because the fragment is user-editable text in the address bar: someone truncating
 * a pasted URL must not get a blank page.
 */
export function parseRange(
  fragment: string,
  lineCount: number,
): LineRange | null {
  const match = /^#?L(\d+)(?:-L?(\d+))?$/.exec(fragment.trim());
  if (match === null) return null;

  const first = Number(match[1]);
  const second = match[2] === undefined ? first : Number(match[2]);

  // L0 does not exist. Line numbering starts at 1, so a zero is a truncated or
  // hand-edited fragment, not a request for the line before the first.
  if (first < 1 || second < 1) return null;
  // Past the end of the body is also nothing: clamping it to the last line would
  // silently answer a different question than the URL asked.
  if (first > lineCount || second > lineCount) return null;

  // `#L20-L10` is reversed rather than invalid — the user dragged upwards, or the two
  // ends were swapped by hand. Order them instead of refusing.
  return { start: Math.min(first, second), end: Math.max(first, second) };
}

/** The canonical form. A single line is `#L12`, never `#L12-L12`, so the URL someone
 *  pastes into a ticket is the shortest thing that means what they selected. */
export function formatRange(range: LineRange): string {
  return range.start === range.end
    ? `#L${range.start}`
    : `#L${range.start}-L${range.end}`;
}
