"use client";

import { motion, useReducedMotion } from "motion/react";

import Link from "next/link";

import { CopyValue } from "@/components/body-tools";
import { pasteUrlForBrowser } from "@/lib/paste-url";
import { Button } from "@/components/ui/button";
import { RETENTION } from "@/lib/expiry/retention";
import { formatBytes, formatCount } from "@/lib/format";
import type { RetentionCode } from "@/lib/types";

// What the form shows after a submit. In the static phase every path lands on
// "nothing was sent", which the prototype designs rather than treats as an error
// (ux-05): the user did everything right and the product has not been built yet, so
// the screen says exactly that instead of apologising in red.

// `{ kind: "saved" }` is gone from this union: a save is `?saved=<id>` on the URL and
// `SavedPanel` renders it. Leaving it here would have been a second way to reach the same
// screen, with the heading bug intact on that path.
export type Receipt =
  | {
      kind: "not-sent";
      message: string;
      landsIn?: string;
      bytes: number;
      lines: number;
      retention: RetentionCode;
    }
  | { kind: "offline" }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "too-large"; bytes: number }
  | { kind: "failed"; message: string };

/**
 * The save confirmation, rendered by the PAGE from `?saved=<id>` rather than by the form.
 *
 * Separate from `CreateReceipt` because the two have different owners and different
 * lifetimes. A refusal belongs to the form — it carries text that was never sent, so it
 * must not survive a navigation. A save belongs to the URL: the heading above the form has
 * to disappear with it, and "New paste" has to be able to navigate back, neither of which
 * is possible while the state lives in a client component the page cannot see.
 */
export function SavedPanel({ id }: { id: string }) {
  const reduced = useReducedMotion();

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card border-rule flex max-w-2xl flex-col gap-4 rounded-lg border p-6"
      aria-live="polite"
    >
      <Saved id={id} />
      <SavedActions id={id} />
    </motion.section>
  );
}

export function CreateReceipt({
  receipt,
  onDismiss,
}: {
  receipt: Receipt;
  onDismiss: () => void;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.section
      // A REFUSAL FADES, at Appendix E's 180 ms, and does not rise. There is nothing to
      // confirm and the text is still in the form behind it, so the panel should appear
      // rather than perform. The save's longer single gesture is in `SavedPanel` above,
      // and Appendix E records why the two differ.
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="bg-card border-rule flex max-w-2xl flex-col gap-4 rounded-lg border p-6"
      aria-live="polite"
    >
      <Body receipt={receipt} />
      {/* Every branch here is a refusal, and the only thing to do with a refusal is return
          to the form with the text still in it. The save has its own panel above, owned by
          the page. */}
      <div className="flex gap-3">
        <Button onClick={onDismiss}>Back to the form</Button>
      </div>
    </motion.section>
  );
}

function Body({ receipt }: { receipt: Receipt }) {
  switch (receipt.kind) {
    case "not-sent":
      return (
        <>
          <h2 className="text-lg">Nothing was sent</h2>
          <p className="text-ink-2">
            The form validated and the request reached the server, which refused
            it: saving is not built yet.
          </p>
          <dl className="border-rule flex flex-col border-t pt-3 text-sm">
            <Row
              label="Would have kept it"
              value={RETENTION[receipt.retention].label}
            />
            <Row
              label="Size"
              value={`${formatBytes(receipt.bytes)} · ${formatCount(receipt.lines)} lines`}
            />
            {receipt.landsIn === undefined ? null : (
              <Row label="Lands in" value={receipt.landsIn} />
            )}
          </dl>
          <p className="text-muted-foreground font-mono text-xs">
            {receipt.message}
          </p>
        </>
      );

    case "offline":
      return (
        <>
          <h2 className="text-lg">You are offline</h2>
          <p className="text-ink-2">
            The text is still in the form. Nothing was sent, and nothing was
            lost — reconnect and save again.
          </p>
        </>
      );

    case "rate-limited":
      return (
        <>
          <h2 className="text-lg">Too many pastes just now</h2>
          <p className="text-ink-2">
            The limit counts attempts, not saves, so a refused paste still costs
            one. Try again in {receipt.retryAfterSeconds} seconds.
          </p>
        </>
      );

    case "too-large":
      return (
        <>
          <h2 className="text-lg">That is a file, not a snippet</h2>
          <p className="text-ink-2">
            {formatBytes(receipt.bytes)} is over the limit. Nothing was sent.
          </p>
        </>
      );

    case "failed":
      return (
        <>
          <h2 className="text-lg">That did not save</h2>
          <p className="text-ink-2">
            The text is still in the form, so nothing was lost.
          </p>
          <p className="text-muted-foreground font-mono text-xs">
            {receipt.message}
          </p>
        </>
      );
  }
}

/**
 * The save confirmation (designed here, not in the prototype).
 *
 * THE PROTOTYPE HAS NO SUCCESS STATE. ux-05 is "Saved: nothing was sent" — the
 * static-phase placeholder — and every other designed receipt is a refusal, because when
 * the prototype was drawn nothing could save.
 *
 * ONE GESTURE, 900 ms, borrowed deliberately. The reference is this author's other
 * project: `boyanliu.me`'s contact form, whose sent state rises `2rem` and fades over
 * 0.9s on `cubic-bezier(0.22, 1, 0.36, 1)` — `.enter-up` in its stylesheet — with a bold
 * headline, an accent full stop, prose held to a `40ch` measure, and one button to go
 * again. No check mark, no stagger, no second thing moving.
 *
 * That restraint is the point, and it replaced a first attempt here that had a check mark
 * scaling in at 260 ms AND the URL sliding up 120 ms behind it. Two gestures to announce
 * one event reads as a product pleased with itself; one slow gesture reads as the page
 * settling, which is what a save is.
 *
 * WHY 900 ms AGAINST APPENDIX E's 90–200 ms, which is a real conflict and not an
 * oversight: that budget governs micro-interactions — a hover, a crossfade, a badge
 * changing state — where anything slower sits between the user and their next action.
 * This is not one. It marks an irreversible event that just produced a permanent address,
 * nothing is waiting behind it, and the reader's next move is to read the link that
 * arrives with it. Appendix E records the carve-out rather than leaving the number looking
 * broken.
 */
function Saved({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-2xl font-semibold">
        Saved
        <Mark />
      </h2>

      <p className="text-ink-2 max-w-[44ch]">
        The link below is permanent. It keeps answering after the paste expires
        — with a receipt instead of the text, never a dead end.
      </p>

      <p className="border-rule bg-background rounded-md border px-3 py-2 font-mono text-sm break-all">
        {pasteUrlForBrowser(id)}
      </p>
    </div>
  );
}

/** The accent full stop after the headline, lifted from the same reference. Decorative. */
function Mark() {
  return (
    <span
      aria-hidden="true"
      className="bg-brand ml-[0.05em] inline-block size-[0.16em] rounded-full align-baseline"
    />
  );
}

/**
 * The actions a save offers: read it, or share it.
 *
 * NO "NEW PASTE" HERE. It was a third copy of a control the nav and the hero already
 * carry, and all three now do the same thing — navigate to `/`, which drops `?saved=`.
 * Two of them are permanently on screen, so the one inside the card bought nothing and
 * competed with the two actions that are specific to having just saved something.
 */
function SavedActions({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* VIEW IS PRIMARY. After saving, the thing people do is check that it looks right —
          and this screen is also the only confirmation that the paste renders at all. */}
      <Button asChild>
        <Link href={`/p/${id}`}>View paste</Link>
      </Button>
      <CopyValue
        value={pasteUrlForBrowser(id)}
        label="Copy link"
        doneLabel="Link copied"
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-rule flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
