---
version: 1
slug: "src-app-new-page-tsx"
primary_target: "src/app/new/page.tsx"
related_targets:
  [
    "src/components/create-form.tsx",
    "src/components/expiry-readout.tsx",
    "src/components/findings-panel.tsx",
    "src/components/create-receipt.tsx",
  ]
---

## Scope and mode

The create form (`src/app/new/page.tsx` and the components it holds). Visitor mode:
**Operate**.

Split out of `src/app/page.tsx` on 19 Nov 2026. The form itself was not redesigned — it is
the ux-01 – ux-12 composition that shipped through M12 and it arrives here intact. What
changed is that it stopped sharing a surface with an argument for the product, which is
recorded in `src-app-page-tsx.md`.

Audience: someone who already has a block of text and wants a URL for it. Signed out is a
first-class state: the page renders, the scanner runs, and the refusal happens on submit
rather than at the door.

Job: save text, with its retention understood before saving. Success is a URL and a receipt.

## Direction contract

THESIS: **Ambition here is precision, not expression.** This is a tool a person uses with
text already on their clipboard, so the patterns are the ones they already know — labelled
fields, a native select, a submit button — and the design work is in making the
consequences legible before the irreversible action. Nothing on this page is novel for its
own sake; the one thing it does that a pastebin normally does not is tell you the two dates
your paste will hit, while you can still change them.

OWN-WORLD: Paste's existing system, unchanged, as `src-app-page-tsx.md` states it. The
Operate-specific commitments:

- **Quoted control.** Machine-written values — the expiry date, the purge date, byte
  counts, line counts, the finding's `line N, column N`, the preview — are Atkinson
  Hyperlegible Mono. Prose is Host Grotesk. The two never swap.
- **Live-state.** `--brand` appears on the Save button and on the `bg-brand-soft` preview
  of a finding. It never appears on a refusal.
- **Refusal is `--bad`, and it is never also an affordance.** While a tier-1 finding is
  live, Save is disabled and the reason sits beside it in `--bad`. The server refuses it
  either way; this is the affordance telling the truth about what the server will do.
- **Earned motion.** One animation on this page: the expiry date crossfades at 120ms,
  opacity only, when retention changes. The select itself never animates. Appendix E.
- **Measured column.** The form is a `minmax(0,1fr)` against a fixed 22rem aside, and the
  textarea is `field-sizing-fixed` with `rows={16}` so it scrolls internally — a box that
  grows pushes the retention panel off screen, which is the one thing the page exists to
  surface.

STORY: A person pastes a log, watches the scanner clear it or refuse it, reads the date the
link stops answering, and saves. Someone who has nothing to paste yet clicks a sample from
the row under the heading and sees any of the five designed states without composing one.

FIRST VIEWPORT: 1440×900, under the 56px header. An h1 "New paste" with "Pick how long it
lives now. There is no delete button later." beneath it; a row of five sample links with
the current one in a `--rule` bordered chip; then the form — Title, the 16-row textarea
with its live scan badge, Language / Keep it for / Line numbers in a single row, and Save —
against the 22rem aside carrying the refusal panel when there is one and the
"Before it gets a link" readout always.

FORM: no roll. An Operate surface inherits the incumbent implementation; this brief records
it rather than directing a redesign.

FINISH: covered by the finish review of the split.

## Unresolved

- Four assertions in `sample-links.e2e.ts` need a Clerk session to run — the receipt
  states. They are skipped rather than deleted, with the reason on each.
- `?saved=` is the source of truth for the saved state. It survives a reload, which is
  right, and it also means a shared `/new?saved=…` URL shows the other person the form
  rather than a receipt. That is the intended outcome of `mayShowSavedReceipt` and worth
  stating in case it reads as a bug.
