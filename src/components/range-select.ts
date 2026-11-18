// The ONLY client script on the view page (ARCHITECTURE N11).
//
// This page is the hot path, it renders hostile content, and every kilobyte of
// JavaScript on it is attack surface and latency for a page whose job is to display
// text. So: no React, no framework, no imports beyond a pure parser. A module-graph
// test fails the build if `shiki` or `motion` ever reaches this route.

import { formatRange, parseRange, type LineRange } from "@/lib/range";

const SELECTED = "hl";

export function mountRangeSelect(container: HTMLElement): () => void {
  const lineCount = Number(container.dataset.lineCount ?? "0");
  const lines = () => container.querySelectorAll<HTMLElement>(".line[id]");

  let anchor: number | null = null;

  function paint(range: LineRange | null) {
    for (const line of lines()) {
      const n = Number(line.id.slice(1));
      const on = range !== null && n >= range.start && n <= range.end;
      line.classList.toggle(SELECTED, on);
    }
    // The input mirrors the selection so it can be read and copied. It is not the
    // source of truth; the fragment is.
    const field = document.querySelector<HTMLInputElement>("#line-range");
    if (field !== null)
      field.value = range === null ? "" : formatRange(range).slice(1);
  }

  function lineNumberFrom(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) return null;
    const line = target.closest<HTMLElement>(".line[id]");
    if (line === null) return null;
    const n = Number(line.id.slice(1));
    return Number.isFinite(n) ? n : null;
  }

  function onClick(event: MouseEvent) {
    // Let a real link inside the body win. Shiki does not emit links, but a future
    // transformer might, and swallowing a click on one would be invisible.
    if (event.target instanceof Element && event.target.closest("a") !== null)
      return;

    const line = lineNumberFrom(event.target);
    if (line === null) return;

    const next: LineRange =
      event.shiftKey && anchor !== null
        ? { start: Math.min(anchor, line), end: Math.max(anchor, line) }
        : ((anchor = line), { start: line, end: line });

    paint(next);

    // replaceState, NOT `location.hash = …`.
    //
    // Assigning to location.hash pushes a history entry per click, so someone who
    // shift-clicks around a log and then presses Back is trapped scrolling through
    // their own selections instead of leaving the page. This keeps the URL shareable
    // and the history at one entry, which a test asserts.
    history.replaceState(null, "", formatRange(next));
  }

  function applyFragment() {
    const range = parseRange(location.hash, lineCount);
    paint(range);
    if (range === null) return;
    anchor = range.start;

    const target = container.querySelector<HTMLElement>(`#L${range.start}`);
    if (target === null) return;

    // Scroll after the fonts settle. The body is monospace and next/font swaps the
    // real face in after first paint; scrolling before that lands on the wrong line
    // because every row changes height underneath the browser.
    const scroll = () => target.scrollIntoView({ block: "center" });
    if (document.fonts?.status === "loaded") scroll();
    else void document.fonts?.ready.then(scroll);
  }

  container.addEventListener("click", onClick);
  // A hand-edited fragment, or Back/Forward between two selections.
  window.addEventListener("hashchange", applyFragment);
  applyFragment();

  return () => {
    container.removeEventListener("click", onClick);
    window.removeEventListener("hashchange", applyFragment);
  };
}
