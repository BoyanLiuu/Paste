---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["public/shots", "scripts/capture-shots.mts"]
---

## Scope and mode

The landing page (`src/app/page.tsx`). Visitor mode: **Persuade**.

**The create form is no longer part of this surface.** It moved to `src/app/new/page.tsx`
on 19 Nov 2026, which is the one structural decision this brief exists to record. For
twelve milestones `/` was the editor, and the first attempt at a home page put argument
sections underneath it — one surface answering two questions. The person arriving with text
to store wants the controls immediately; the person who followed somebody's link wants to
know what happens to their text before typing any. See `src-app-new-page-tsx.md` for the
form's own brief, which is Operate.

Audience: developers on the open web, arriving from a search or from a link somebody sent
them. Job: decide whether this site is trustworthy enough to put text in. Action: open
`/new`, or open a sample. Proof available: four screenshots of the running app, regenerable
by `pnpm shots`, and figures read out of the modules that define them. No customers, logos,
testimonials, counts or competitor comparisons exist or may be invented — see PRODUCT.md,
Evidence on Hand.

## Direction contract

THESIS: **The evidence is photographs of the product, and every one of them is one click
from the screen it photographs.** The argument is not made in adjectives next to an
illustration; it is made by showing the four states that embody the three mechanisms, at
the size the UI actually is, each linked to its live route so a sceptic can check it in a
second. Refuses the category default — a centred headline over sub-copy over a button, with
a drawn gradient mockup in a fake browser frame — and refuses the previous arrangement,
where the working editor stood in for an argument and the visitor had to try the product
before being told what it was.

OWN-WORLD: Paste's existing system, unchanged. `--paper` near-black ground, `--paper-2`
for raised panes, hairline `--rule` dividers at 1px, 12px radii on panes and 9px on
controls. TWO semantic accents: `--brand` oklch(82% 0.15 80) owns live and affirmative
state, `--bad` oklch(70% 0.17 25) owns refusal — which is why the "Three things it will not
do" terms are in `--bad` and the section numbers are in brand. Host Grotesk for text,
Atkinson Hyperlegible Mono for every machine-written value: ids, hashes, dates, routes,
figures, section indices. No gradients, no glass, **no shadow** — and no drawn browser
chrome around a screenshot, which is the same rule applied to the evidence. Recognisable
with all content removed by: hairline-ruled section bands at full bleed, a 20rem copy
column against a wide image column, dense mono fact rows, and screenshots that are never
scaled above the size they were captured at.

STORY: The visitor reads one sentence about what the product refuses to do, sees a real
paste being read, then scrolls past three photographs of the mechanism: a credential
refused with Save disabled, a 410 receipt carrying a live SHA-256, an expiry date shown
before anything is saved. They believe it because they can click any one of those images
and land on the route that produced it. They open `/new`.

FIRST VIEWPORT: 1440×900, under the existing 56px app-shell header. Left-aligned, max 52rem:
a 12px tracked mono eyebrow in brand, the headline "Paste it once. The link keeps
answering." at 56px/1.05, three sentences of 18px sub-copy naming the three refusals, then
New paste in brand beside Open a sample in secondary. Below, a two-column band:
`read.png` at its captured 976px — a real paste with syntax highlighting, line numbers and
lines 4–8 selected from the fragment — against a right column holding the four checkable
figures at 30px mono over 14px labels. The figures sit there because the screenshot is
never upscaled and the remaining ~300px of the 1312px content width would otherwise be air.

FORM: "The editor is the hero" was dealt by the roll and built; the user then pinned a
different structure, and a pinned brief beats a roll. The structure is the one the user
gave by example: a hero with a product shot, then one section per feature, each carrying a
screenshot of that feature. seed:c7c7da99f2e37595 (superseded by the pin).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
the verdict, DESIGN.md, and every shipping raster carrying its provenance — here, a
committed capture script rather than a note.

## Resolved since the last revision

- **Screenshots or live components?** Screenshots, by the user's instruction: "the whole
  point is i want to use some screenshot to indicate the feature we support in home page."
  Mitigated against rot by `scripts/capture-shots.mts`, so the files are output rather than
  artefacts, and by linking each one to its route so a stale shot is visibly stale.
- **Comparison with pastebin?** Declined by the user. Not on this page.
- **The create form's own heading.** Moot: the form has its own route and its own h1.

## Unresolved

- On a 390px viewport the screenshots render at roughly 0.34x and no word in them is
  legible. The link to the live route is the current answer. A narrow-viewport capture set
  would read better and doubles the number of images to keep current.
- `retention.png` is 582px of panel in a ~928px column, so section 03 carries more air
  than 01 and 02. The panel genuinely is small; left as honest rather than magnified.
