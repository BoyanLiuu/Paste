# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers on the open web, confirmed 19 Nov 2026. Someone has a block of text that
is awkward to send in a chat message — a stack trace, a config file, a 20 MB `kubectl`
log, a snippet a colleague needs to run — and wants a URL for it.

They arrive from a search or from a link somebody sent them, which is two distinct
situations and — since 19 Nov 2026 — two distinct surfaces: `/` argues the product to
someone deciding whether to trust it, and `/new` is the form for someone who already has
text to store. For twelve milestones those were one page, and the result answered neither
question well. The product competes with pastebin.com, GitHub gists and collaborative
editors, so the category is understood and the differentiation has to be explicit.

## Product Purpose

Save a block of text in one action and get a URL back; open that URL later and read the
text highlighted, with any line or line range linkable; choose how long the paste lasts
and — once it has lapsed — still get a receipt at that URL rather than a dead end.

Success is a link that is still worth clicking two years later, in either sense: it
resolves, and what it resolves to is honest about what used to be there.

## Positioning

Three mechanisms a neighbouring pastebin could not truthfully claim:

1. **A credential never gets an addressable URL.** The secret scan runs _before_ the
   insert, not after, so a tier-1 finding writes **zero rows** — there is no paste, no id
   and nothing to retract. Most tools scan after publication, which means the window
   between paste and detection is a window in which the secret is live on the internet.
2. **Every identifier that has ever existed keeps resolving.** Zero 404s for a known id.
   An expired paste answers 410 with a receipt — who made it, when, how large, and the
   SHA-256 of the bytes that are gone — so someone holding a local copy can prove it is
   the same text. A lapsed link does not become a typo.
3. **Nothing is editable and nothing is self-deletable.** There is no edit and no delete
   button; removal is a request a moderator decides, with the decision and its reason on
   an append-only record. A redaction removes the secret and keeps the link working, with
   a permanent notice saying it happened.

The three compose into one promise: the bytes are immutable, the identifier is permanent,
and the only way content changes is a destructive supersession that says so.

## Operating Context

- A paste link is cited in a ticket, a code review, an incident document or a chat
  thread, and is read months or years later by someone who was not there.
- The text pasted is routinely machine output rather than hand-written code: logs,
  config, stack traces, `kubectl` dumps. One designed fixture is a 214,880-line log of
  20.1 MB.
- Reading requires no account. Creating requires a session, so a reader who followed a
  link meets no wall and a creator does.

## Capabilities and Constraints

- **Create:** 25 MB ceiling for every caller. Retention is chosen at create — 1 hour,
  1 day, 30 days (default) or never, where `never` requires a one-line written reason
  stored on the paste. The expiry date and purge date are shown before saving.
- **Secret scanning:** 220 rules compiled from gitleaks, in three tiers, inside a 150 ms
  budget for bodies up to 256 KB. Tier 1 is a hard block with no override. Tier 2 and 3
  can be saved past with a typed justification, which is recorded. Findings can be
  redacted in place and re-scanned before saving.
- **Reading:** syntax highlighting up to 2,000 lines, rendered once at save and stored —
  the read path ships no highlighter. Above the threshold, plain text with a banner
  saying so. Above 2 MB, the first 500 lines with the full text available by download.
  Line numbers are a stored property of the paste, so `#L42` means one thing for every
  reader.
- **Language detection:** a ladder — explicit choice, then filename extension, then a
  first-line sniff, then a log detector, then a fallback. First match wins.
- **Bytes:** one download endpoint, served as an attachment. There is deliberately no
  inline raw endpoint; the bytes are never rendered as a page.
- **After saving:** fork into a new id with provenance, which re-runs the scanner because
  a fork is a create. Open a removal request. Read the audit record.
- **Moderation:** a queue showing each request's justification and the paste's 90-day
  read count. Three outcomes — redact, delete, deny — each requiring a note.
- **Accounts:** Clerk, currently on a development instance. Sign-in is required to create
  and never to read.
- **Surfaces:** `/` (Persuade — the landing page, static, no request reads), `/new`
  (Operate — the create form, public, with the samples as `?sample=` links), `/p/:id`
  (Read), `/list/:username`, `/moderation`, `/sign-in`, `/sign-up`.

## Brand Commitments

- The name is **Paste**. A wordmark exists in the app shell.
- The voice is the one the project's own documents use: plain, specific, and free of
  superlatives. Claims carry a number or an example, or they are not made. "Secrets are
  caught before saving; redaction and expiry never break the link" is the existing
  statement of the product and is accurate.
- No emoji in product copy.

## Evidence on Hand

**What exists and is true:**

- The running application, at every state worth showing: a tier-1 AWS key refused before
  a link exists, a tier-2 finding needing a justification, a 410 receipt carrying its
  SHA-256, a redacted paste with its permanent notice, a line-range permalink, a 20 MB
  log truncated with its banner. Real screenshots of these are approved evidence.
- Four screenshots in `public/shots/`, captured from the running application by
  `pnpm shots` — a highlighted paste with a line-range permalink, a tier-1 refusal with
  Save disabled, a **purged** 410 receipt whose bytes are destroyed and whose SHA-256 is
  not, and the retention panel. Their subjects are seeded by `pnpm shots:seed` under the
  visibly synthetic `shots-demo` owner, and their dimensions are generated into
  `shot-sizes.generated.ts` at capture time rather than written into the page. They are
  approved evidence **because they are reproducible**: a committed script regenerates them
  from the live routes, and each one on the page links to the route it came from. A
  screenshot nobody can re-take is the `ux-*.png` problem below, arriving later.
- The live create form at `/new`, reachable signed out. The scanner reports findings as the
  visitor types, before any account exists — approved as an interactive demonstration.
  It is no longer on the home page.
- Figures that are checkable in the repository: 220 compiled rules, a 150 ms scan budget,
  a 2,000-line highlight threshold, a 25 MB ceiling, 449 unit tests and 165 end-to-end.
  Where a page prints one of these it **reads it from the module that defines it** rather
  than restating it, so the copy cannot drift from the code.
- A designed fixture corpus used by the app and its tests.

**What does not exist and must never be invented:** no customers, no company logos, no
testimonials, no user counts, no traffic or uptime figures, no press, no funding, no
pricing. The user confirmed on 19 Nov 2026 that no company uses this product. A logo
strip or a review quote on this page would be a fabrication.

**Also declined:** a comparison table against pastebin.com or any named competitor. The
user ruled it out on 19 Nov 2026. Showing the mechanism is the stronger claim, and a
comparison argues a case the visitor has not opened.

**Superseded:** the 58 `ux-*.png` renders in `docs/project-idea/25-paste-snippet-sharing/hallmark/ux/`
are pre-Hallmark and show a look the application no longer has. They are readable as a
record of which states were designed; they must not ship as product imagery.

## Product Principles

1. **A refusal before publication beats a retraction after it.** Anything that would put
   a credential at a URL is refused at the point of creation, not cleaned up later.
2. **The identifier is the product.** Every answer a URL can give — content, a 410
   receipt, a redaction notice — keeps the link meaningful. A 404 for an id that once
   existed is the one outcome the design does not permit.
3. **Say what happened.** A redaction is visible, a decision carries its reason, an
   automatic purge is attributed to the instrument rather than a person. Silent changes
   would make every other paste's content unverifiable.
4. **Claims are checkable or absent.** Every number in the product and on its pages
   traces to something measurable in the repository.

## Accessibility & Inclusion

WCAG 2.1 AA, asserted with axe over six screens and enforced in the end-to-end suite.
Every animated surface settles under `prefers-reduced-motion: reduce`. The create form's
submit is reachable by keyboard and the view page has no focus trap. Loading placeholders
announce themselves rather than carrying an ignored `aria-label`.
