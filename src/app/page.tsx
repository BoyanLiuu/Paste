import Image from "next/image";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { formatBytes, formatCount } from "@/lib/format";
import {
  HIGHLIGHT_LINES,
  MAX_BYTES,
  TRUNCATE_BYTES,
  TRUNCATE_LINES,
} from "@/lib/render/thresholds";
import { RULES } from "@/lib/secrets/rules.generated";

import { SHOT_SIZES, type ShotName } from "@/lib/shot-sizes.generated";
import { LIVE_SUBJECT_ID, PURGED_SUBJECT_ID } from "@/lib/shot-subjects";

// GET / — the landing page.
//
// IT IS NOT THE CREATE FORM ANY MORE, and that was the point of this change. For twelve
// milestones `/` was the editor, and the first attempt at a home page put marketing
// sections underneath it — which made one surface answer two questions at once. The person
// who arrives with text to store and the person deciding whether to trust the product want
// opposite things from the same pixels: one wants the controls immediately, the other wants
// to know what happens to their text before typing any. The editor lives at `/new` now
// (Operate) and this is Persuade.
//
// THE EVIDENCE IS PHOTOGRAPHS OF THE PRODUCT. Every claim below sits beside a screenshot of
// the real application in the state that claim describes. `pnpm shots` captures them from
// the running app, so the four files in `public/shots/` can be regenerated rather than
// slowly drifting from the thing they depict — and that reproducibility is the only reason
// screenshots are the right medium here. The 58 pre-Hallmark `ux-*.png` renders in the docs
// folder are what happens otherwise: PRODUCT.md now has to carry a note saying they must
// not ship.
//
// WHAT IS DELIBERATELY ABSENT. No logo strip, no testimonial, no user count, no uptime
// figure, no pricing — PRODUCT.md's Evidence section forbids inventing them, and nobody
// uses this product yet. No comparison table either: naming a competitor to win an argument
// the visitor has not started is a weaker move than showing the mechanism.
//
// STATIC. Nothing on this page reads the request, so the whole route prerenders — no
// Suspense boundary, no `searchParams`, no viewer. The only session-dependent thing on
// screen is the header's account slot, which resolves behind its own boundary inside
// `AppShell`.

/** Checkable, and READ rather than typed. Appendix H: a figure written into copy is a
 *  figure free to go stale, and a landing page is the worst place for that to happen. */
const FIGURES = [
  {
    value: formatCount(RULES.length),
    label: "secret rules, run before the insert",
  },
  {
    value: formatCount(HIGHLIGHT_LINES),
    label: "lines highlighted, rendered once at save",
  },
  { value: formatBytes(MAX_BYTES), label: "ceiling, for every caller" },
] as const;

// THE FOURTH FIGURE WAS `"0"`, typed, in a row sitting under a comment saying these are read
// rather than typed. It also framed an architectural invariant as a measurement: "0 404s for
// an id that once existed" is not a number anybody counted, it is a rule the design enforces.
// It belongs in the sentence below the row, as a claim, not in a column of measured values.
const INVARIANT = "No id that has ever existed returns a 404.";

export default function Page() {
  return (
    <AppShell current={null} bleed>
      <Hero />
      <Features />
      <Limits />
      <Questions />
      <Footer />
    </AppShell>
  );
}

function Hero() {
  return (
    <section className="border-rule border-b">
      <div className="container-page flex flex-col gap-14 py-20">
        <div className="flex max-w-[52rem] flex-col gap-6">
          {/* NO EYEBROW. "SNIPPET SHARING" sat here in brand mono and said nothing the
              headline does not — a category label above a heading, which is the generic
              shape this page's thesis claims to refuse, and mono used as costume where the
              system reserves it for machine-written values. `text-balance` because the
              headline set as "Paste it once. The / link keeps answering." at both 1440 and
              1024, splitting the article from its noun. */}
          <h1 className="text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[3.5rem]">
            Paste it once. The link keeps answering.
          </h1>
          <p className="text-ink-2 max-w-[46ch] text-lg leading-relaxed">
            No account needed. A credential is refused before it has a URL. A
            lapsed paste answers with a receipt instead of a 404. Nothing is
            editable, by anyone, ever.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/new">New paste</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/new?sample=python">Open a sample</Link>
            </Button>
          </div>

          {/* IN THE SUB-COPY NOW, NOT A 14px LINE UNDER THE BUTTONS. It sat there as the
              quietest thing in the first viewport while being the fact most likely to
              decide whether someone clicks — and section 01 below now carries the evidence
              for it, so the hero only has to state it. */}
        </div>

        {/* THE PRODUCT, IN THE FIRST VIEWPORT, WITH THE FIGURES BESIDE IT.
            The shot is a reader's view of a real paste: highlighted, numbered, with lines
            4–8 selected from the `#L4-L8` in the URL. It is the screen most people who
            ever touch this product will see, so it is the one that opens the page.

            The figures sit in the column the image cannot fill. `read.png` is 976 CSS
            pixels and is never scaled up, which leaves about 300px of the 1312px content
            width over — so it holds the four checkable numbers rather than air. Below
            `xl` they stack under the image behind their own hairline, where they read as
            a list. The `dl`'s breakpoints have to match the grid's: while they said `lg`
            and the grid said `xl`, 1024–1280 stacked the figures AND removed the rule
            that separates them from the image. */}
        {/* `xl:`, NOT `lg:`, AND A FLOOR ON THE SECOND TRACK. Measured: at 1280 the figures
            column was 128px and `25.0 MB` broke across two lines; at 1100 and below the
            `<dt>` measured 0px wide and its content overflowed the track. The cause is
            `minmax(0,61rem)` on the image — a 976px *maximum* the first track grows into,
            taking the whole 976px content width at 1024 and leaving nothing. A figure that
            wraps inside the number is the most visible way this page can look unfinished,
            and 1024–1280 is a laptop rather than an edge case. */}
        <div className="grid gap-10 xl:grid-cols-[minmax(0,61rem)_minmax(16rem,1fr)] xl:gap-12">
          <Shot
            name="read"
            priority
            alt="A paste of a JavaScript retry helper, with syntax highlighting and line numbers, lines 4 to 8 highlighted, above Copy link, Copy, Download and Fork buttons."
            caption="Following a shared link needs no account. The line-range fragment never reaches the server."
            href={`/p/${LIVE_SUBJECT_ID}#L4-L8`}
          />

          <dl className="border-rule flex flex-col gap-7 border-t pt-7 sm:grid sm:grid-cols-2 xl:flex xl:border-t-0 xl:pt-0">
            {FIGURES.map(({ value, label }) => (
              <div key={label} className="flex flex-col gap-1">
                {/* `whitespace-nowrap` is the braces to the track floor's belt: a value
                    may not break inside itself even if a future layout squeezes this
                    column to nothing again. */}
                <dt className="num font-mono text-3xl whitespace-nowrap">
                  {value}
                </dt>
                <dd className="text-muted-foreground max-w-[24ch] text-sm leading-relaxed">
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-muted-foreground text-sm">{INVARIANT}</p>
      </div>
    </section>
  );
}

/** The three mechanisms PRODUCT.md says a neighbouring pastebin could not truthfully
 *  claim, each one beside the screen where it happens. */
function Features() {
  return (
    <div className="container-page flex flex-col gap-24 py-24">
      {/* FIRST, BECAUSE IT IS THE ONE THAT CHANGES WHETHER SOMEONE BOTHERS. The three
          sections after it are the mechanisms PRODUCT.md names as the product's
          positioning; this one is the precondition for ever seeing them, and it was the
          only claim on the page asserted in prose and shown nowhere — on a page whose
          whole thesis is that its evidence is photographs. The receipt IS the proof.

          The copy's job is to stop "no account needed" reading as "and nothing is kept",
          which is what it means on most sites. */}
      <Feature
        title="No account needed to start"
        body={
          <>
            A signed-out visitor saves a paste and gets a working link
            immediately — the scanner, the retention choice and the permanent id
            all behave exactly as they do for an account. Signing in afterwards{" "}
            <em className="text-ink not-italic">claims</em> the paste rather
            than saving it: it joins your list, and you can ask for its removal.
            Without one it is linked from that browser alone, and only a
            moderator can remove it.
          </>
        }
        shot={{
          name: "receipt" as const,
          alt: "A receipt reading Saved, with a note that the paste was saved without an account and a sign-in link to keep it, above the paste's absolute URL and View paste and Copy link buttons.",
          caption:
            "The paste is already saved when this appears. Signing in changes who owns it, not whether it exists.",
          href: "/new",
        }}
      />

      <Feature
        title="A secret is refused before the paste exists"
        body={
          <>
            The scan runs <em className="text-ink not-italic">before</em> the
            insert, not after it. A tier-1 finding writes zero rows — no paste,
            no id, nothing to retract. Scanning after publication leaves a
            window in which the credential is live on the internet, and the only
            remedy left is rotation.
          </>
        }
        shot={{
          name: "refused" as const,
          alt: "The new-paste form holding an AWS config file. A panel reads This cannot be saved, Pattern that may indicate AWS credentials, line 3 column 21. The Save button is disabled.",
          caption:
            "Save refuses while the finding is live. The preview prints four characters at each end, never the secret.",
          href: "/new?sample=aws",
        }}
      />

      <Feature
        title="The identifier outlives the text"
        body={
          <>
            Every id that has ever existed keeps resolving. An expired paste
            answers <span className="font-mono">410</span> with a receipt — who
            made it, when, how large it was, and the SHA-256 of the bytes that
            were destroyed — so anyone holding a local copy can prove it is the
            same text. A lapsed link does not become a typo.
          </>
        }
        reverse
        shot={{
          name: "purged" as const,
          alt: "A 410 Gone page reading This snippet is gone, with the creation date and owner, the size in bytes and lines, a SHA-256 digest, and the date the bytes were purged.",
          caption:
            "The bytes are destroyed. The hash, the size, the owner and the dates are not.",
          href: `/p/${PURGED_SUBJECT_ID}`,
        }}
      />

      <Feature
        title="You see both dates before you save"
        body={
          <>
            Retention is chosen once, at create, and the panel shows both
            consequences before the paste has a link: the day it stops serving
            text, and the day the bytes are destroyed. Choosing{" "}
            <span className="font-mono">never</span> requires a written reason,
            stored on the paste. There is no delete button afterwards, so this
            is the decision.
          </>
        }
        shot={{
          name: "retention" as const,
          // NO DATE IN THE ALT TEXT. It said "19 December 2026", which the capture had already
          // stopped showing: the seeded subjects' clock is relative to now, so any date named
          // here drifts the next time `pnpm shots` runs and the description silently stops
          // matching the image for the readers who depend on it most.
          alt: "A panel headed Before it gets a link, showing the expiry date and time, the purge date, and rows for secrets, language, size and highlighting.",
          caption:
            "The purge date is 30 days after the expiry date, so a lapsed paste stays recoverable for a month.",
          href: "/new?sample=python",
        }}
      />
    </div>
  );
}

/**
 * What the product refuses to do.
 *
 * TEXT, NOT A SCREENSHOT, because a section about absences cannot be photographed — there
 * is no screen that shows the edit button failing to be there. These are also the three
 * questions a developer evaluating a pastebin asks before the features interest them.
 */
function Limits() {
  const limits = [
    [
      "No edit",
      "The bytes are immutable, enforced by a database trigger rather than by convention. A redaction appends a new revision and destroys the old one's bytes; it never rewrites them in place.",
    ],
    [
      "No self-delete",
      "You open a removal request and a moderator decides it — redact, destroy or deny — each with a note on an append-only record. The bias is toward keeping the link working.",
    ],
    [
      "No raw endpoint",
      "One download route, serving an attachment, so the browser saves the bytes rather than rendering them. Hostile text never gets an origin to execute in.",
    ],
  ] as const;

  return (
    <div className="border-rule border-y">
      <div className="container-page grid gap-10 py-20 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-20">
        <h2 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
          Three things it will not do
        </h2>
        <dl className="grid gap-10 sm:grid-cols-3">
          {limits.map(([term, detail]) => (
            <div key={term} className="flex flex-col gap-3">
              <dt className="text-bad font-mono text-sm">{term}</dt>
              <dd className="text-ink-2 text-sm leading-relaxed">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Feature({
  title,
  body,
  shot,
  reverse = false,
}: {
  title: string;
  body: React.ReactNode;
  shot: Omit<React.ComponentProps<typeof Shot>, "priority">;
  /** Put the copy on the right at `xl`, so three sections do not read as a list. */
  reverse?: boolean;
}) {
  return (
    // NOT 50/50. The screenshots are 582–1048 CSS pixels wide and are never scaled up, so
    // an even split would leave the widest one downscaled and the narrowest one adrift in
    // half a page of nothing. A 20rem column of copy against the remainder gives the
    // images close to their natural size at 1440.
    //
    // THE TRACK SIZES SWAP WITH THE ORDER, which is the bug this comment is here to stop
    // coming back. Reversing with `xl:order-2` alone moves the copy into the second track
    // and leaves the image in the 20rem one — the 410 receipt rendered at 318px, which is
    // a thumbnail of a page rather than a readable screenshot. The image has to stay in
    // the `1fr` track whichever side it is on.
    <section
      className={`reveal-section grid items-center gap-10 xl:gap-16 ${
        reverse
          ? "xl:grid-cols-[minmax(0,1fr)_20rem]"
          : "xl:grid-cols-[20rem_minmax(0,1fr)]"
      }`}
    >
      {/* THE DIRECTION FOLLOWS THE VISUAL SIDE, NOT THE DOM ORDER. A reversed section puts
          the copy on the right and the image on the left, so the classes have to swap with
          it — otherwise half the sections would slide in from the side they are already on,
          which reads as a glitch rather than an entrance. */}
      <div
        className={`flex flex-col gap-5 ${reverse ? "reveal-right xl:order-2" : "reveal-left"}`}
      >
        {/* NO `01` / `02` / `03`. There were numbers on the heading's baseline until this
            pass, inherited from a mono kicker (`01 BEFORE IT EXISTS`) whose chronology had
            already been folded into the headings themselves — "before the paste exists",
            "outlives", "before you save". Once that happened the digit counted sections
            rather than telling the reader anything: these four are not steps, nothing
            depends on reading them in order, and four is not a number anyone needs
            labelled. On a phone it was also pushing every second line of the heading into a
            ragged hanging indent. */}
        <h2 className="max-w-[24ch] text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="text-ink-2 max-w-[52ch] leading-relaxed">{body}</p>
      </div>

      <div
        className={`reveal-shot ${reverse ? "reveal-left" : "reveal-right"}`}
      >
        <Shot {...shot} />
      </div>
    </section>
  );
}

/**
 * A screenshot with its caption.
 *
 * `next/image` RATHER THAN `<img>`, for the one property that matters on this page: the
 * files are 2x captures, so `read.png` is 1952px wide and a plain `<img>` would send all
 * of it to a phone. With intrinsic dimensions declared, Next serves a width that suits the
 * viewport and reserves the box before the bytes arrive, so no section jumps as its image
 * loads.
 *
 * NO SHADOW AND NO DRAWN BROWSER CHROME. DESIGN.md's No-Shadow rule holds here as
 * everywhere: the screenshots carry the app's own paper colour, so a 1px rule is enough to
 * separate them from the page — and a fake window frame around a real screenshot only
 * invites the question of what else was drawn.
 *
 * THE ALT TEXT DESCRIBES THE STATE, not the file. Someone who cannot see the image is the
 * reader most dependent on this page's claims being legible in prose, and "screenshot of
 * the app" tells them nothing about whether the Save button was disabled.
 *
 * EVERY SHOT LINKS TO THE SCREEN IT PHOTOGRAPHS, which started as a fix for phones and is
 * the better answer everywhere. At 390px a 1048-pixel screenshot of a form is a 0.34x
 * thumbnail: the layout is visible and not one word of it is readable. Rather than hide
 * the images on small screens or hand the visitor a horizontal scrollbar with no
 * affordance, the image is a link to the live route — `/p/AerfZDG4`, `/new?sample=aws` —
 * so the unreadable thumbnail is one tap from the readable thing.
 *
 * It also makes the page's central claim checkable. Every assertion here is "the product
 * does this", and the fastest rebuttal to a screenshot is that screenshots can be drawn.
 * These ones are one click from the route that produced them.
 */
function Shot({
  name,
  alt,
  caption,
  href,
  priority = false,
}: {
  /** A key of the generated manifest, which supplies the file and its real dimensions. */
  name: ShotName;
  alt: string;
  caption: string;
  /** The live route this was captured from. */
  href: string;
  priority?: boolean;
}) {
  // READ, NOT DECLARED. These were four hand-written `width`/`height` pairs until the
  // retention panel's capture changed shape and its pair did not — rendering that
  // screenshot at 0.44x with a reserved box the wrong aspect. `pnpm shots` emits the
  // manifest, so the numbers cannot disagree with the files again.
  const { file, width, height } = SHOT_SIZES[name];
  const src = `/shots/${file}`;
  return (
    // NEVER WIDER THAN IT WAS CAPTURED, and this cap is the difference between a page
    // that looks photographed and one that looks mocked up. The first version let each
    // image fill its column: `refused.png` is 1048 CSS pixels of form and shrank to 0.6x,
    // `retention.png` is a 582-pixel panel and was blown up to 1.5x, so the three sections
    // showed what looked like three different products at three different zoom levels.
    // On the figure rather than the image, so the caption shares the image's measure
    // instead of running wider than the thing it describes.
    <figure
      className="flex flex-col gap-3"
      style={{ maxWidth: `${width / 2}px` }}
    >
      <Link
        href={href}
        className="focus-visible:ring-ring/50 rounded-lg focus-visible:ring-[3px] focus-visible:outline-none"
      >
        <Image
          src={src}
          width={width}
          height={height}
          alt={alt}
          priority={priority}
          sizes={`(min-width: 1280px) ${width / 2}px, 100vw`}
          className="border-rule hover:border-ink-2/40 h-auto w-full rounded-lg border transition-colors"
        />
      </Link>
      {/* THE ROUTE IS A LINK NOW. It used to be inert text in the caption while the image
          above was the only anchor — so the one element that LOOKED clickable was not one,
          and the image's sole affordance was a 1px border that changed colour on hover.
          Pointer users got nothing at rest and touch users nothing at all, on a page whose
          thesis is that a sceptic can check any of this in a second. */}
      <figcaption className="text-muted-foreground max-w-[60ch] text-xs leading-relaxed">
        {caption}{" "}
        <Link
          href={href}
          className="text-ink-2 hover:text-ink font-mono whitespace-nowrap underline underline-offset-2"
        >
          {href} →
        </Link>
      </figcaption>
    </figure>
  );
}

function Questions() {
  const qa = [
    [
      "Do I need an account?",
      "No. Reading needs no session, and neither does creating — a paste made without an account gets a working link immediately. Signing in keeps it in your account, lists it under your name, and lets you ask for it to be removed later. Without one, the paste is linked from that browser only and a moderator is the only person who can remove it.",
    ],
    [
      "What happens when it expires?",
      "The URL answers 410 with a receipt rather than a 404. The bytes are purged on a later date, and the SHA-256 survives so a local copy can still be checked against it.",
    ],
    [
      "Can I recover a secret that was blocked?",
      "There is nothing to recover: a tier-1 finding means no row was written. Tier 2 and 3 can be saved past with a typed justification, which is recorded — or redacted in place and re-scanned before saving.",
    ],
    [
      "How big can a paste be?",
      `${formatBytes(MAX_BYTES)}, for every caller. Above ${formatCount(HIGHLIGHT_LINES)} lines there is no syntax highlighting — the markup, not the server, is the limit — and above ${formatBytes(TRUNCATE_BYTES)} the page shows the first ${formatCount(TRUNCATE_LINES)} lines with the whole text available as a download.`,
    ],
    [
      "Can I fork someone else's paste?",
      "Yes, into a new id that records where it came from. A fork is a create, so the scanner runs again — a credential cannot be smuggled in by copying a paste older than the rule that catches it.",
    ],
    [
      "Does it run code?",
      "No. It stores text and shows it back to you. The download endpoint serves bytes as an attachment, never as a page.",
    ],
  ] as const;

  return (
    <div className="container-page grid gap-10 py-24 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-20">
      <h2 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
        Questions
      </h2>
      <dl className="border-rule border-t">
        {qa.map(([q, a]) => (
          <div key={q} className="border-rule border-b py-6">
            <dt className="font-medium">{q}</dt>
            <dd className="text-ink-2 mt-2 max-w-[68ch] leading-relaxed">
              {a}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-rule border-t">
      <div className="container-page flex flex-col gap-10 py-16">
        <div className="flex flex-col gap-5">
          {/* AN `h2` AT THE ESTABLISHED SIZE, not a one-off 24px `<p>`: this is the page's
              closing beat and the only one that had no heading, while 1.5rem semibold
              appeared exactly once in the whole scale.

              AND THE CLAIM IS NOW ABOUT THE MECHANISM. It read "the link will still be
              answering in two years" — an uptime promise about a service with no users and
              no SLA, which PRODUCT.md forbids and which is the first line a sceptical
              developer would point at. What is true and checkable is that the id keeps
              resolving once the text is gone. */}
          <h2 className="max-w-[40ch] text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
            Paste something. The id keeps resolving after the text is gone.
          </h2>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/new">New paste</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/new?sample=python">Open a sample</Link>
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground max-w-[70ch] text-xs leading-relaxed">
          Reading and creating both work without an account; signing in is what
          keeps a paste in your name. Retention is chosen once and shown before
          saving. There is no edit and no delete.
        </p>
      </div>
    </footer>
  );
}

export const metadata = {
  title: "Paste — paste once, the link keeps answering",
  description:
    "A pastebin that refuses credentials before they get a URL. When a paste lapses the id keeps resolving — a receipt with its SHA-256, never a 404.",
};
