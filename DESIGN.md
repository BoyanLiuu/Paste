---
name: Paste
description: A near-black instrument panel for text that has to still answer in two years.
colors:
  paper: "oklch(17% 0.008 250)"
  paper-2: "oklch(21% 0.009 250)"
  paper-3: "oklch(13.5% 0.007 250)"
  ink: "oklch(95% 0.005 250)"
  ink-2: "oklch(83% 0.008 250)"
  muted-foreground: "oklch(71% 0.01 250)"
  rule: "oklch(31% 0.01 250)"
  rule-2: "oklch(42% 0.012 250)"
  brand: "oklch(82% 0.15 80)"
  brand-ink: "oklch(18% 0.04 75)"
  brand-soft: "oklch(29% 0.05 80)"
  bad: "oklch(70% 0.17 25)"
  bad-soft: "oklch(24.5% 0.035 25)"
  ok: "oklch(76% 0.15 150)"
  ok-soft: "oklch(24.5% 0.03 150)"
  cool: "oklch(77% 0.12 245)"
  cool-soft: "oklch(29% 0.05 245)"
typography:
  display:
    fontFamily: "Host Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.728rem"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Host Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Host Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Host Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Host Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0.14em"
  outlier:
    fontFamily: "Atkinson Hyperlegible Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "tabular-nums"
rounded:
  pill: "6px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
  3xl: "22px"
  4xl: "26px"
spacing:
  3xs: "2px"
  2xs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  2xl: "64px"
  3xl: "96px"
  4xl: "144px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-ink}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-destructive:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.bad}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  textarea-code:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.outlier}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
  pane:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  pane-refusal:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  badge-default:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.4xl}"
    padding: "2px 8px"
    height: "20px"
  badge-destructive:
    backgroundColor: "{colors.bad-soft}"
    textColor: "{colors.bad}"
    rounded: "{rounded.4xl}"
    padding: "2px 8px"
    height: "20px"
  nav-link-active:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  fact-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    padding: "10px 0"
---

# Design System: Paste

## Overview

**Creative North Star: "The Instrument Panel"**

Paste is a near-black reading instrument. Every surface is one of three paper tiers,
separated by 1px hairlines rather than by shadow, and every number the machine produced —
an id, a hash, a byte count, an expiry date, a line number — is set in a mono face so a
reader can tell at a glance which words came from the product and which came from a person.
The system was established in the project's approved dark-only prototype and has held
across twelve milestones; `src/app/globals.css` is its single source of truth and there is
no light theme to maintain (`color-scheme: dark`, no `.dark` class).

The register is forensic rather than dramatic. Panes are quiet (`--paper-2` on `--paper`),
code sits on a recessed `--paper-3` band, and colour appears only where it carries meaning:
amber where something is live, red where something is refused, green where something is
clean, blue where something is a machine-read figure worth noticing. There are no
gradients used as surface fill, no glass, no elevation shadows, and no decorative imagery —
this product renders text, and the rules the prototype carried for photographic treatment
were dropped on the way in.

Density is high and deliberately tabular. The recurring unit across every screen is a
definition list of hairline-divided fact rows — label left in muted ink, machine value
right in mono with tabular figures — used by the expiry readout, the 410 tombstone, the
save receipt, the retention table and the home page's figure rail. That row is the house
pattern; a new surface that needs to state facts should reach for it before inventing
anything.

**Key Characteristics:**

- Dark-only, three paper tiers, hairline `--rule` dividers at 1px
- Two semantic accents: amber for live, red for refusal (plus green for clean, blue for figures)
- Host Grotesk for language, Atkinson Hyperlegible Mono for machine-written values only
- 10px radius on nearly everything; flat surfaces, no elevation shadows
- 4px spacing grid; a 1440px measured column with a 64/24/16px gutter
- Motion is scoped, information-bearing, and absent by default

## Colors

A near-neutral blue-black ground (hue 250 across every neutral) carrying four semantic
hues that are never decorative.

### Primary

- **Signal Amber** (`--brand`): live and affirmative state, and nothing else. The primary
  button fill, the caret, the selection highlight, the underline on the loaded sample tab,
  the highlighted-line wash on a code body, the signed-in username, a highlighted secret
  span (`--brand-soft` as its background), the Shiki keyword colour. Text on an amber fill
  is **Amber Ink** (`--brand-ink`), never white.

### Secondary

- **Refusal Red** (`--bad`): refusal, and only refusal. The findings panel's border and
  wash (`--bad/50` on `--bad-soft/30`), the "This cannot be saved" heading, field errors,
  the destructive button and badge. A refusal rendered in amber would make "cannot be
  saved" look like an affordance; that is why the system has two accents and not one.

### Tertiary

- **Clean Green** (`--ok`, `--ok-soft`): the scanner's clean verdict, and the Shiki string
  colour.
- **Figure Blue** (`--cool`, `--cool-soft`): a machine figure the reader should notice but
  not fear — a finding's line/column coordinate, an urgent-but-not-expired date, a time of
  day, the Shiki constant and function colours.

### Neutral

- **Paper** (`--paper`): the page ground; `--background`.
- **Raised Paper** (`--paper-2`): every pane, card, popover and active nav pill.
- **Recessed Paper** (`--paper-3`): the code body band inside `.paste-body pre`, the one
  surface that sits _below_ the page.
- **Ink** (`--ink`) and **Ink 2** (`--ink-2`): primary text and prose text. Long body copy
  is `--ink-2`; headings and emphasised values are `--ink`.
- **Muted Ink** (`--muted-foreground`): labels, captions, line-number gutter, comments.
- **Rule** (`--rule`) and **Rule 2** (`--rule-2`): the 1px dividers and control borders
  that do all the structural work in place of shadow.

### Named Rules

**The Two Accents Rule.** Amber owns live and affirmative state; red owns refusal. They are
not interchangeable and neither is ever used as decoration. A new surface that wants a
colour for "important" does not get one.

**The Live-State Rule.** Amber marks the thing that is currently true — the loaded tab, the
selected lines, the session, the primary action. If a device would be amber in two places
on one screen for two different reasons, one of them is wrong.

## Typography

**Display Font:** Host Grotesk (via `next/font`, `--font-display`, falling back to
`ui-sans-serif, system-ui, sans-serif`)
**Body Font:** Host Grotesk — one text face, used for every piece of language
**Label/Mono Font:** Atkinson Hyperlegible Mono (`--font-outlier`, falling back to
`ui-monospace, monospace`)

**Character:** A tight, modern grotesque for everything a person wrote, against a
hyperlegible mono for everything a machine wrote. The pairing is the product's honesty
mechanism rather than a style choice: the mono face is how you can tell a hash from a
sentence without reading either.

### Hierarchy

The ramp is a 1.2 step: `0.75 / 0.875 / 1 / 1.2 / 1.44 / 1.728 / 2.074rem`. Headings carry
weight 500, `letter-spacing: -0.03em`, `line-height: 1.05`, `text-wrap: balance` and a
character-count max-width.

- **Display** (500, 1.728rem, 1.05, max 20ch): the `h1` on every route — a tombstone
  headline, a page title, the save confirmation.
- **Headline** (500, 1.2rem, 1.05, max 30ch): `h2`, section and panel headings.
- **Title** (500, 1rem, 1.2, max 40ch): `h3`, the smallest named heading.
- **Body** (400, 1rem, 1.55): prose, in `--ink-2`, held to a 62–70ch measure where it runs
  long.
- **Label** (400, 0.75rem, `0.14em` tracking, uppercase for the one scroll cue; otherwise
  sentence case): captions, figure labels, footnotes, in muted ink.
- **Outlier / mono** (400, 0.875rem, 1.6): ids, URLs, SHA-256 digests, dates, times, byte
  counts, line/column coordinates, retention terms, endpoint names, code bodies.

### Named Rules

**The Machine-Written Rule.** Mono is reserved for values the machine produced. It is never
a costume for making prose look technical — if a human wrote the words, they are set in
Host Grotesk.

**The Tabular Column Rule.** Any figure that is compared down a column carries the `num`
utility (`font-variant-numeric: tabular-nums`): sizes, line counts, view counts, dates.

## Layout

A single measured column, declared once as the `container-page` utility: `max-width:
var(--container)` (1440px) with `padding-inline: var(--gutter)`, where the gutter steps
64px → 24px (≤60rem) → 16px (≤40rem). The app shell wraps every route in it with a 56px
(`h-14`) hairline-bottomed header above a `py-10` main.

Spacing is a 4px grid. There are deliberately **no** `--spacing-*` theme tokens — in
Tailwind v4 that namespace also drives every sizing utility, so a named spacing step
silently rewrites `max-w-*`. Use the numeric utilities (`2` = 8px, `4` = 16px, `6` = 24px,
`10` = 40px, `16` = 64px, `24` = 96px, `36` = 144px); the `--space-*` custom properties
exist for hand-written CSS only (`.paste-body`, `scroll-padding-top`).

Multi-column surfaces are explicit two-column grids that collapse to one at `lg`: the
create form is `minmax(0,1fr) 22rem` with its expiry panel on the right; argument sections
are `lg:grid-cols-2` with a 40–64px gap; the questions block is `18rem minmax(0,1fr)`. Every
column that can hold code carries `min-w-0` so a long line scrolls inside the pane instead
of widening the page, and `html, body { overflow-x: clip }` backs that up.

Stacking order is tokenised (`--z-base` 1 through `--z-tooltip` 600) so overlay layers are
chosen rather than guessed.

### Named Rules

**The Measured Column Rule.** Every route renders inside `container-page`. `AppShell`'s
`bleed` prop is the single documented exception, for a surface that composes its own
full-width regions; it drops the container and its padding and that surface then owns its
own gutters.

**The Hairline Grid Rule.** Regions are divided by a 1px `--rule` border on the shared
edge, not by a gap, a background change or a card. A fact table is a `dl` of rows each
carrying `border-b border-rule`, with the last row's border removed.

## Elevation & Depth

This system is flat and uses tonal layering plus hairlines. There is **no shadow
vocabulary**: no ambient shadow, no elevation ramp, no glass, no blur. Depth is read from
three facts — which paper tier a surface sits on (`--paper-3` recessed, `--paper` ground,
`--paper-2` raised), whether it has a `--rule` border, and its 10px radius. Overlays
(dialog, popover, tooltip, toast) separate themselves with `--paper-2` plus a border and a
z-index token, not with a cast shadow.

Focus is the one place something is added on top: a global `:focus-visible { outline: 2px
solid var(--ring); outline-offset: 2px }` plus the primitives' own 3px `--ring/50` ring.
That ring is an affordance, not elevation.

### Named Rules

**The No-Shadow Rule.** Surfaces never cast. If a region needs to read as separate, change
its paper tier or give it a hairline. The only `box-shadow` anywhere in the build is a 2px
_inset_ brand band used as an underline on the loaded sample tab, which is a border
substitute and not a licence to introduce elevation.

**The rule extends to the evidence.** A screenshot gets the same 1px hairline as any other
pane — no drop shadow, no perspective tilt, no drawn browser chrome with traffic-light
dots. Those devices exist to make a mockup look like a real screen; drawing one around an
actual screenshot only raises the question of what else was drawn.

## Shapes

One radius does nearly all the work: `--radius` is 0.625rem (10px), exposed as
`rounded-lg`, and it is what panes, cards, inputs, textareas, dialogs and default buttons
use. The derived steps exist for the primitives that reach for them — `--radius-md` (8px) on
the active nav pill and small/icon buttons (capped via `min()` so a 24px control never
over-rounds), the upper steps (`2xl`–`4xl`) only because shadcn's own badge uses
`rounded-4xl`, which on a 20px-tall badge resolves to a capsule. `--radius-pill` (6px) is
the prototype's small-chip radius.

Borders are always 1px and almost always `--rule`; a refusal pane borders in `--bad/40–50`.
Code bodies are square-edged full-bleed bands inside their pane, with the line-number gutter
rendered as a CSS counter in `::before` (4ch wide, right-aligned, unselectable) so a
select-all copies the body and nothing else. Icons are inline SVG with `stroke-width: 1.8`
and round caps; the wordmark is a rule over three dots.

## Components

The character across all of them: instrument-panel restraint — small controls, hairline
borders, no fill unless the control is the primary action.

### Buttons

- **Shape:** 10px radius (`rounded-lg`); 32px tall by default (`h-8`, `px-2.5`,
  `text-sm`, weight 500), with 24/28/36px steps and square icon sizes.
- **Primary:** amber fill with amber-ink text. One per region.
- **Hover / Focus:** fill drops to 80% opacity; `:focus-visible` adds a `--ring` border
  plus a 3px `--ring/50` ring; `:active` nudges down 1px (`translate-y-px`). All of it
  through `transition-all`.
- **Outline / Secondary / Ghost:** outline is a `--rule` border on a transparent-to-`--input/30`
  ground, hovering to the muted surface; secondary is a raised-paper fill; ghost has no
  border and only a hover surface. Link variant is amber text with an underline on hover.
- **Destructive:** red text on a 10–20% red wash, never a solid red fill.

### Badges

- **Style:** 20px tall capsules, `text-xs` weight 500, `px-2`. Default is an amber fill
  (used for a state that is _true now_, e.g. "Redacted"); secondary is raised paper (used
  for a state that is _over_, e.g. "Purged 9 Oct"); outline is a `--rule` border for a
  neutral marker ("Removal asked", a tier number); destructive is the red wash.

### Cards / Containers

- **Corner Style:** 10px.
- **Background:** raised paper (`--paper-2`), or the page ground when the pane is quoting
  something.
- **Shadow Strategy:** none — see Elevation & Depth.
- **Border:** 1px `--rule`; `--bad/40–50` when the pane carries a refusal.
- **Internal Padding:** 20–24px for a standing panel, 16px for a findings pane, 12px/8px
  for a nested fact row.

### Inputs / Fields

- **Style:** 1px `--input` border on a transparent ground (`--input/30` in dark), 10px
  radius, 32px tall, `text-sm` from `md` up. Labels sit above in body weight; a hint sits
  below in `text-xs` muted ink.
- **Focus:** border shifts to `--ring` and a 3px `--ring/50` ring appears; colour only, no
  size change.
- **Error / Disabled:** `aria-invalid` borders and rings in `--destructive`; the message
  itself is `text-bad text-sm` in a `role="alert"` region. Disabled drops to 50% opacity
  with a filled input ground.
- **Code textarea:** the same field in mono at `text-sm` with `field-sizing-fixed` and
  `resize-y`, so a 20,000-line paste cannot stretch the field past the viewport.

### Navigation

The shell header is a 56px hairline-bottomed bar: wordmark plus name at weight 500, then
text-sm links. A link is muted ink with a hover to full ink and a `transition-colors`; the
active link becomes a raised-paper pill with a `--rule` border and carries
`aria-current="page"`. Session-dependent links each sit behind their own Suspense boundary
with a `null` fallback, so nothing flashes a placeholder for a link that may never arrive.

### Fact Row (signature)

The system's most-reused element. A `dl` with a `border-t border-rule`, then rows of
`flex items-baseline justify-between border-b border-rule py-2`: label left in muted ink,
value right — mono and `num` when the machine produced it. It appears as the expiry
readout's four rows, the tombstone's 410 receipt grid, the save receipt's summary, the
retention table and the home page's figure rail. New surfaces that state facts use it.

### Evidence Figure (signature)

The landing page's unit of argument, and the only place the system shows a picture of
itself. A `<figure>` capped at the screenshot's captured CSS width, holding the image in a
`rounded-lg border-rule` link to the live route it was captured from, then a 12px
`figcaption` carrying one sentence and the route in mono.

Three properties are load-bearing:

1. **Captured, not drawn.** Every image comes from `pnpm shots`, which drives the running
   app. A screenshot nobody can regenerate goes stale silently — see the 58 superseded
   `ux-*.png` renders.
2. **Never upscaled.** The figure's `max-width` is the capture width, so a shot renders at
   1:1 or slightly under and the UI inside it is the size the UI is. Letting images fill
   their column put one at 0.6x and another at 1.5x, and the page read as three different
   products.
3. **Linked to its route, visibly.** Both the image and the route printed in the caption
   are links. The route was inert text outside the anchor at first, so the one element that
   looked clickable was not one and the image's only affordance was a border that changed on
   hover — nothing at rest for a pointer, nothing at all for touch.
4. **Its subject is seeded, and visibly synthetic.** Every screenshot's paste is created by
   `pnpm shots:seed` under the `shots-demo` owner. The first version photographed a real row
   in one developer's database, which put a real personal handle in the hero of a public page
   and made `pnpm shots` fail everywhere else.
5. **Its dimensions are generated, not declared.** `pnpm shots` writes
   `shot-sizes.generated.ts` and the page reads it. Hand-written pairs went stale within an
   afternoon: a layout fix reshaped one capture and its declaration did not follow, rendering
   that screenshot at 0.44x in a box of the wrong aspect.

### Loading placeholders

A single `animate-pulse` block matching the shape it replaces (a bordered 10px rectangle,
or a strip the exact height of the tab bar), always carrying `role="status"` and an
`aria-label`. ARIA prohibits a label on a role-less element, so a bare labelled `<div>` is
a defect, not a shortcut.

### Motion

Motion is scoped to the moments where it carries information the reader would otherwise
have to reconstruct, and the doctrine lives in ARCHITECTURE.md Appendix E. The budget is
**90–200 ms, `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`), opacity and colour before
layout, no springs on anything containing text, and nothing that moves layout while a
pointer or caret is inside it**. Durations are tokenised as `--dur-micro` (120ms) and
`--dur-short` (180ms); the prototype's 420ms and its ease-in curves were deliberately not
ported, because a token that is wrong to use is worse than an absent one.

- Expiry date crossfade, 120 ms, opacity only (`AnimatePresence mode="popLayout"`).
- Findings panel expands from zero height, 180 ms; each finding fades in staggered 40 ms.
- Refusal receipts fade at 180 ms and do not rise.
- Line-range highlight: `background-color` 90 ms, CSS only.
- **The save receipt is the one carve-out at 900 ms** — a 2rem rise and fade on
  `cubic-bezier(0.22, 1, 0.36, 1)`, one gesture for one irreversible event, borrowed from
  `boyanliu.me`'s sent state so the two screens are the same gesture.
- **Nothing animates on the view page or the 410 tombstone**, and the home page is
  **motionless by decision**: its own composition has no entrance, scroll or reveal
  animation, only the hover colour changes of its controls. Text that fades in is text that
  was slower to read.
- JS motion gates on `useReducedMotion`; CSS motion is caught by one global
  `prefers-reduced-motion: reduce` query that collapses every animation and transition to
  0.01ms with `!important` on the universal selector (near-zero rather than `none`, so
  Radix exit animations still fire `animationend` and unmount).

### Named Rules

**The Earned Motion Rule.** An animation ships only if it carries information: the
consequence of a choice, the arrival of a refusal, the exit of a row from a queue. Default
is no motion.

**The One Gesture Rule.** One event gets one moving object. Two things moving to announce
one save reads as a product pleased with itself.

**The Quoted Control Rule.** When a real component is embedded in an argument as evidence,
it keeps its shape and loses its fill: the region is `inert`, and descendant buttons and
links are stripped to a `--rule` border with `--ink-2` text, so a quoted primary action
cannot compete with the page's own.

## Do's and Don'ts

### Do:

- **Do** take every colour, radius, type step and duration from `src/app/globals.css`.
  It is the single source of truth, declared through Tailwind v4 `@theme` / `@utility`.
- **Do** keep the two accents semantic: `--brand` for live and affirmative, `--bad` (with
  `--bad-soft`) for refusal, `--ok` for clean, `--cool` for a notable machine figure.
- **Do** set every machine-written value in `--font-outlier`, with `num` on anything
  compared down a column.
- **Do** build fact statements as hairline `dl` rows — label left in muted ink, value right
  in mono.
- **Do** divide regions with a 1px `--rule` border and a change of paper tier.
- **Do** wrap routes in `container-page`; use `AppShell`'s `bleed` only for a surface that
  composes its own full-width regions.
- **Do** give every loading placeholder `role="status"` with an `aria-label`, shaped like
  the thing it replaces.
- **Do** keep the view route to its single client module (`body-tools.tsx`) and its
  transitions in CSS; `view-page-budget.spec.ts` and `view-route-imports.spec.ts` fail the
  build otherwise.
- **Do** keep stored render output free of inline `style` attributes — Shiki declarations
  are moved to generated classes by `src/lib/render/tokens.ts` so the per-request-nonce CSP
  can stay at `style-src 'self'` (asserted by `no-inline-styles.spec.ts`).

### Don't:

- **Don't** add an elevation shadow, a glass/backdrop-blur surface, or a gradient used as a
  surface fill. (Gradients as a `mask-image` overflow fade are an existing, legitimate
  device; the prohibition is on gradients as decoration.)
- **Don't** add a light theme or a `.dark` class. The system is dark-only and `:root`
  carries the palette.
- **Don't** render a refusal in amber or a live state in red.
- **Don't** use mono as a technical costume for prose, or proportional figures in a column.
- **Don't** declare `--spacing-*` theme tokens; that namespace also drives sizing utilities
  and will silently collapse `max-w-*`.
- **Don't** introduce a motion token outside the 90–200 ms ease-out band, or a spring on
  anything containing text. The 900 ms save receipt is the only carve-out and it is already
  documented.
- **Don't** animate the view page or the 410 tombstone, and don't add an entrance or
  scroll-reveal animation to the home page.
- **Don't** put more than one amber-filled primary action in a region, and don't leave a
  quoted component's primary fill intact.
- **Don't** invent customers, logos, testimonials, counts or traffic figures as visual
  content; PRODUCT.md records that none exist.
- **Don't** display a screenshot wider than it was captured, and don't add a drawn window
  frame, tilt or shadow to one. See Evidence Figure.
- **Don't** type a figure into copy that a module already computes. The expiry panel claimed
  the scanner was not wired up for six milestones after it was, and a landing page is a
  worse place for that to happen than a form.
