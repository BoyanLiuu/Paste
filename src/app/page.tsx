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
  { value: "0", label: "404s for an id that once existed" },
] as const;

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
          <p className="text-brand font-mono text-xs tracking-[0.12em] uppercase">
            Snippet sharing
          </p>
          <h1 className="text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[3.5rem]">
            Paste it once. The link keeps answering.
          </h1>
          <p className="text-ink-2 max-w-[46ch] text-lg leading-relaxed">
            A credential is refused before it has a URL. A lapsed paste answers
            with a receipt instead of a 404. Nothing is editable, by anyone,
            ever.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/new">New paste</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/new?sample=python">Open a sample</Link>
            </Button>
          </div>
        </div>

        {/* THE PRODUCT, IN THE FIRST VIEWPORT, WITH THE FIGURES BESIDE IT.
            The shot is a reader's view of a real paste: highlighted, numbered, with lines
            4–8 selected from the `#L4-L8` in the URL. It is the screen most people who
            ever touch this product will see, so it is the one that opens the page.

            The figures sit in the column the image cannot fill. `read.png` is 976 CSS
            pixels and is never scaled up, which leaves about 300px of the 1312px content
            width over — so it holds the four checkable numbers rather than air. Below
            `lg` they stack under the image, where they read as a list. */}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,61rem)_minmax(0,1fr)] lg:gap-12">
          <Shot
            src="/shots/read.png"
            width={1952}
            height={1126}
            priority
            alt="A paste at /p/AerfZDG4: JavaScript with syntax highlighting and line numbers, lines 4 to 8 highlighted, above Copy link, Copy, Download and Fork buttons."
            caption="Following a shared link needs no account. The line-range fragment never reaches the server."
            href="/p/AerfZDG4#L4-L8"
          />

          <dl className="border-rule flex flex-col gap-7 border-t pt-7 sm:grid sm:grid-cols-2 lg:flex lg:border-t-0 lg:pt-0">
            {FIGURES.map(({ value, label }) => (
              <div key={label} className="flex flex-col gap-1">
                <dt className="num font-mono text-3xl">{value}</dt>
                <dd className="text-muted-foreground max-w-[24ch] text-sm leading-relaxed">
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** The three mechanisms PRODUCT.md says a neighbouring pastebin could not truthfully
 *  claim, each one beside the screen where it happens. */
function Features() {
  return (
    <div className="container-page flex flex-col gap-24 py-24">
      <Feature
        index="01"
        label="Before it exists"
        title="A secret never reaches a URL"
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
          src: "/shots/refused.png",
          width: 2096,
          height: 1678,
          alt: "The new-paste form holding an AWS config file. A panel reads This cannot be saved, Pattern that may indicate AWS credentials, line 3 column 21. The Save button is disabled.",
          caption:
            "Save refuses while the finding is live. The preview prints four characters at each end, never the secret.",
          href: "/new?sample=aws",
        }}
      />

      <Feature
        index="02"
        label="After it lapses"
        title="The identifier outlives the text"
        body={
          <>
            Every id that has ever existed keeps resolving. An expired paste
            answers <span className="font-mono">410</span> with a receipt — who
            made it, when, how large it was, and the SHA-256 of the bytes that
            are gone — so anyone holding a local copy can prove it is the same
            text. A link in a two-year-old ticket does not become a typo.
          </>
        }
        reverse
        shot={{
          src: "/shots/expired.png",
          width: 1456,
          height: 894,
          alt: "A 410 Gone page reading This snippet expired, with the creation date and owner, a size of 803 bytes over 17 lines, a SHA-256 digest, and the date the bytes are purged.",
          caption:
            "The hash outlives the bytes, and so do the size, the owner and the dates.",
          href: "/p/ShotExp1",
        }}
      />

      <Feature
        index="03"
        label="At the moment of saving"
        title="You pick the lifetime, and you see the date"
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
          src: "/shots/retention.png",
          width: 816,
          height: 918,
          alt: "A panel headed Before it gets a link, showing an expiry date of 19 December 2026 with its time and purge date, then rows for secrets, language, size and highlighting.",
          caption:
            "Shown before saving, because afterwards it is not yours to change.",
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
  index,
  label,
  title,
  body,
  shot,
  reverse = false,
}: {
  index: string;
  label: string;
  title: string;
  body: React.ReactNode;
  shot: Omit<React.ComponentProps<typeof Shot>, "priority">;
  /** Put the copy on the right at `lg`, so three sections do not read as a list. */
  reverse?: boolean;
}) {
  return (
    // NOT 50/50. The screenshots are 582–1048 CSS pixels wide and are never scaled up, so
    // an even split would leave the widest one downscaled and the narrowest one adrift in
    // half a page of nothing. A 20rem column of copy against the remainder gives the
    // images close to their natural size at 1440.
    //
    // THE TRACK SIZES SWAP WITH THE ORDER, which is the bug this comment is here to stop
    // coming back. Reversing with `lg:order-2` alone moves the copy into the second track
    // and leaves the image in the 20rem one — the 410 receipt rendered at 318px, which is
    // a thumbnail of a page rather than a readable screenshot. The image has to stay in
    // the `1fr` track whichever side it is on.
    <section
      className={`grid items-center gap-10 lg:gap-16 ${
        reverse
          ? "lg:grid-cols-[minmax(0,1fr)_20rem]"
          : "lg:grid-cols-[20rem_minmax(0,1fr)]"
      }`}
    >
      <div className={`flex flex-col gap-5 ${reverse ? "lg:order-2" : ""}`}>
        <p className="text-muted-foreground flex items-baseline gap-3 font-mono text-xs tracking-[0.12em] uppercase">
          <span className="text-brand">{index}</span>
          {label}
        </p>
        <h2 className="max-w-[24ch] text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">
          {title}
        </h2>
        <p className="text-ink-2 max-w-[52ch] leading-relaxed">{body}</p>
      </div>

      <Shot {...shot} />
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
  src,
  width,
  height,
  alt,
  caption,
  href,
  priority = false,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  /** The live route this was captured from. */
  href: string;
  priority?: boolean;
}) {
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
          sizes={`(min-width: 1024px) ${width / 2}px, 100vw`}

          className="border-rule hover:border-ink-2/40 h-auto w-full rounded-lg border transition-colors"
        />
      </Link>
      <figcaption className="text-muted-foreground max-w-[60ch] text-xs leading-relaxed">
        {caption}{" "}
        <span className="text-ink-2 font-mono whitespace-nowrap">{href}</span>
      </figcaption>
    </figure>
  );
}

function Questions() {
  const qa = [
    [
      "Do I need an account?",
      "To read, never. Every paste is readable by anyone with the link, with no session and no wall. To create one, yes — a paste carries a known owner, which is what makes the removal queue and the audit record mean anything.",
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
          <p className="max-w-[34ch] text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Paste something. The link will still be answering in two years.
          </p>
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
          Reads are public and need no account; creating a paste needs a
          session. Retention is chosen once and shown before saving. There is no
          edit and no delete.
        </p>
      </div>
    </footer>
  );
}

export const metadata = {
  title: "Paste — paste once, the link keeps answering",
  description:
    "A pastebin that refuses credentials before they get a URL, and whose links answer forever — with a receipt instead of a 404.",
};
