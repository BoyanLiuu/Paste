// Line markup for the bodies Shiki does not render.
//
// Above the §6.2 threshold there is no stored render, so the view page falls back to
// escaped plain text with the same per-line structure. Same classes, same ids, same
// CSS — the gutter and the range permalink work identically whether the body was
// highlighted or not, which is the point: the banner tells the user highlighting is
// off, and nothing else about the page changes.

/** Escaped **before** anything else touches it. Shiki escapes its own output, but the
 *  invariant must not depend on the highlighter being correct — a grammar bug has to
 *  degrade into ugly text, never into script execution (§6.5). This path has no
 *  highlighter at all, so it does the escaping itself. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** `id="L12"` on each line, but only when the paste asked for numbers.
 *
 *  Always emitting them would double the node count of a 20 000-line log for the
 *  majority of pastes that never link a line (§6.2). It also means a paste without
 *  numbers has no line anchors, which is intended: numbering is a stored property of
 *  the snippet, so `#L42` either means something for every reader or for none. */
export function lineId(n: number): string {
  return `L${n}`;
}

/**
 * Plain-text line markup, matching the shape Shiki's `classic` structure produces.
 *
 * `<span class="line">` per line, newline between them, inside `<code><pre>`. The
 * numbers themselves are never in the DOM — they come from a CSS counter on `.line`,
 * so a select-all cannot capture them. That is the most common bug in this category
 * and the reason the gutter is not a column of cells.
 */
export function renderPlain(body: string, lineNumbers: boolean): string {
  const lines = body.replace(/\n$/, "").split("\n");
  const spans = lines.map((line, index) => {
    const id = lineNumbers ? ` id="${lineId(index + 1)}"` : "";
    // An empty line still needs a box to number and to highlight, hence the &nbsp;.
    const content = line === "" ? "&nbsp;" : escapeHtml(line);
    return `<span class="line"${id}>${content}</span>`;
  });
  return `<pre class="shiki-plain"><code>${spans.join("\n")}</code></pre>`;
}

/**
 * Adds per-line ids to already-rendered Shiki HTML.
 *
 * The stored render is generated once per revision, before anyone knows whether this
 * paste wants numbers, so the ids are stamped on read. Deliberately a narrow,
 * counted replacement of Shiki's own `<span class="line">` openings rather than an
 * HTML parse: the input is markup this project generated with a known shape, and the
 * replacement adds an attribute without touching text content, so it cannot alter
 * what the body says.
 */
export function withLineIds(html: string): string {
  let n = 0;
  return html.replaceAll('<span class="line"', () => {
    n += 1;
    return `<span class="line" id="${lineId(n)}"`;
  });
}
