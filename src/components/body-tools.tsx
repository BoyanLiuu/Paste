"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { mountRangeSelect } from "@/components/range-select";

// THE ONE CLIENT MODULE THE VIEW PAGE RENDERS (ARCHITECTURE N11).
//
// One module, two behaviours, and the single boundary is the point rather than tidiness.
// N11 budgets one client script on the hot path, and `view-page-budget.spec.ts` enforces it
// by counting `"use client"` modules reachable from the route — so a copy button in its own
// file would be a second one, and the honest options were to raise the budget or to put both
// behaviours where they belong. They belong together: both are things you do to the body.
//
// Renamed from `range-select-mount.tsx` when the copy buttons landed, because it had stopped
// being only a mount.
//
// Deliberately not inlined into the page as a `<script>`: that would need
// `script-src 'unsafe-inline'` or a nonce, and §6.5 keeps this page's policy at
// `script-src 'self'` because it is the page that renders hostile content.

/** Attaches the line-range selection listener. Owns no markup. */
export function RangeSelectMount({ targetId }: { targetId: string }) {
  useEffect(() => {
    const container = document.getElementById(targetId);
    if (container === null) return;
    // mountRangeSelect returns its own teardown, so it is the effect's cleanup
    // directly — holding it in a ref first added a hop and nothing else.
    return mountRangeSelect(container);
  }, [targetId]);

  return null;
}

/**
 * Copy an arbitrary value. The primitive the other two are built on.
 *
 * EXPORTED FROM HERE, which is a constraint rather than a preference. N11 budgets ONE
 * `"use client"` module on the view route and `view-page-budget.spec.ts` enforces it by
 * counting modules in that route's graph — so a shared `copy-button.tsx` imported by this
 * file would make two, and raising a stated architectural number to tidy a file is the
 * wrong trade. The create receipt imports this instead, which costs that page nothing: it
 * is already a client component and has no budget.
 */
export function CopyValue({
  value,
  label,
  doneLabel,
}: {
  value: string;
  label: string;
  doneLabel: string;
}) {
  return <CopyButton label={label} doneLabel={doneLabel} read={() => value} />;
}

/**
 * Copy the body text, read from the DOM rather than passed in.
 *
 * READ FROM THE DOM, and that is a size decision. Passing the body as a prop would put a
 * second copy of it in the RSC payload — on a paste rendering 1.2 MB of markup that doubles
 * the page, on the route N2 exists to keep cheap.
 *
 * `innerText` AND NOT `textContent`. The line numbers are a CSS counter written with
 * `::before`, so they are generated content: `innerText` reflects what is rendered and
 * leaves them out, while `textContent` would also leave them out but collapse the line
 * structure. This is the whole reason the copy button needs no network call —
 * ARCHITECTURE §6.2 claimed it had to fetch the raw bytes cross-origin precisely because a
 * DOM copy would capture the gutter, and that stopped being true the moment the gutter was
 * built as a counter.
 *
 * A TRUNCATED PASTE COPIES WHAT IS SHOWN. Above the §6.2 threshold the DOM holds only the
 * first 500 lines, so that is what lands on the clipboard — and the page already carries a
 * banner saying so and pointing at the download. Silently copying a partial body with no
 * indication would be the bug; copying exactly what the reader can see is the honest answer.
 */
export function CopyBody({ targetId }: { targetId: string }) {
  return (
    <CopyButton
      label="Copy"
      doneLabel="Copied"
      read={() => document.getElementById(targetId)?.innerText ?? ""}
    />
  );
}

/** Copy this paste's permalink. The other half of ux-16's action row. */
export function CopyLink() {
  return (
    <CopyButton
      label="Copy link"
      doneLabel="Link copied"
      read={() => window.location.href}
    />
  );
}

/**
 * The shared button, with a held confirmation.
 *
 * Appendix E: "Idle → check, hold 1 s, back." That is the only feedback a clipboard write
 * produces — the write itself is silent and `navigator.clipboard` resolves whether or not
 * the user noticed — so without the held state the button is indistinguishable from a
 * button that does nothing.
 */
function CopyButton({
  label,
  doneLabel,
  read,
}: {
  label: string;
  doneLabel: string;
  read: () => string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  // THE TIMER IS CLEANED UP. Without this, clicking copy and navigating away inside the
  // hold window leaves a timer holding a setter for an unmounted component. React 19 no
  // longer warns about that, which is exactly why it is worth writing down: the thing that
  // used to tell you has stopped telling you.
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(read());
      setState("done");
    } catch {
      // Refused rather than broken: the Clipboard API needs a secure context and, in some
      // browsers, a permission. Saying so beats a button that silently did nothing.
      setState("failed");
    }
  }

  const shown =
    state === "idle" ? label : state === "failed" ? "Copy failed" : doneLabel;

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={copy}>
        {shown}
      </Button>
      {/* THE CONFIRMATION, FOR A SCREEN READER.

          The visible label changing is what a sighted user sees, and it is not announced:
          a changed accessible name on a button is not a live update, so nothing reaches a
          screen reader. The first version set `aria-label` to the same changing string,
          which announced nothing and duplicated the visible text — two ways to say the
          same thing, free to drift apart.

          A `role="status"` region is the mechanism that actually announces. Visually
          hidden rather than rendered, because the button beside it already shows the
          text. */}
      <span role="status" className="sr-only">
        {state === "idle" ? "" : shown}
      </span>
    </>
  );
}
