import { Suspense } from "react";

import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CreateForm } from "@/components/create-form";
import { SavedPanel } from "@/components/create-receipt";
import { NOW } from "@/lib/fixtures";
import { isPasteId } from "@/lib/ids";
import { SAMPLE_BODIES } from "@/lib/samples";
import { headers } from "next/headers";

import { isGuestUsername } from "@/lib/guest-handle";
import { originFor, pasteUrl } from "@/lib/paste-url";
import { mayShowSavedReceipt } from "@/lib/server/saved-receipt";
import { getViewer } from "@/lib/server/session";

// GET /new — the create form (ux-01 – ux-12).
//
// ITS OWN ROUTE AS OF THIS CHANGE. The form lived at `/` for twelve milestones, which made
// the home page a tool with an argument wrapped around it. The two surfaces want different
// things: this one is Operate — a person with text to store, who needs the controls legible
// and the consequences visible — and `/` is Persuade, for someone deciding whether to trust
// the product at all. One page cannot lead with both.
//
// Public: it renders for a signed-out visitor, and submitting prompts sign-in rather than
// the route refusing to load (§3).
//
// The samples stay reachable as `?sample=` here, which is how every designed state on this
// screen is opened without typing the right thing — the tier-1 block, the override, the
// 27.5 MB oversize case.

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string; saved?: string }>;
}) {
  return (
    <AppShell current="new">
      <div className="flex flex-col gap-8">
        {/* THE HEADING BELONGS TO THE FORM, NOT THE PAGE, and rendering it here
            unconditionally reintroduced a bug `create-form.tsx` documents as fixed: it sat
            above the receipt telling someone to "pick how long it lives now" for a paste
            they had already saved, with the retention already chosen and unchangeable.
            Measured after the landing-page split put the form on its own route — the
            heading moved with the page and lost the condition.

            Inside the boundary, so it is governed by the same `?saved=` that governs the
            form. */}
        <Suspense fallback={<HeadingSkeleton />}>
          <Heading searchParams={searchParams} />
        </Suspense>

        {/* A placeholder the SHAPE OF THE ROW, not the shape of the form. The first
            version reused `FormSkeleton` here, which flashed a 384px-tall bordered box in
            place of a single line of links — a layout shift the moment it resolved, and
            exactly the "skeleton that does not match what it replaces" the design system
            calls a defect. */}
        <Suspense fallback={<SamplesSkeleton />}>
          <Samples searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<FormSkeleton />}>
          <FormOrReceipt searchParams={searchParams} />
        </Suspense>
      </div>
    </AppShell>
  );
}

/** The page's title, which exists only while there is a form to title. */
async function Heading({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string; saved?: string }>;
}) {
  const { saved } = await searchParams;
  if (saved !== undefined) return null;

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl">New paste</h1>
      <p className="text-muted-foreground">
        Pick how long it lives now. There is no delete button later.
      </p>
    </div>
  );
}

function HeadingSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="h-14 animate-pulse" />
  );
}

/**
 * The sample pastes, as a row of links.
 *
 * THEY HAVE TO LIVE SOMEWHERE VISIBLE, and this is the second time they have moved. In M12
 * they were 11px text under the Save button, where nobody found them; then they were the
 * home page's tab strip, which went away when `/` stopped being an editor. A row under the
 * heading is where someone who does not yet have text to paste looks.
 *
 * Each is a `?sample=` link rather than a button, so a designed state has a URL — the AWS
 * one is how the tier-1 refusal is reached without composing a credential, and
 * `sample-links.e2e.ts` opens every one of them by href.
 */
async function Samples({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string; saved?: string }>;
}) {
  const { sample, saved } = await searchParams;

  // Hidden on the receipt: the paste is saved, and a row of samples beside it would
  // invite replacing text that is already stored at a URL.
  if (saved !== undefined) return null;

  return (
    <nav
      aria-label="Sample pastes"
      className="flex flex-wrap items-baseline gap-2 text-sm"
    >
      {/* The LABEL stays muted and the OPTIONS do not. Every item in this row was
          `text-muted-foreground` with a transparent border until hover, so the lead-in was
          indistinguishable from the five choices and nothing looked clickable at rest —
          the third home these links have had, and still hard to find.

          THREE DIFFERENCES MARK THE CURRENT ONE, not one. Giving the unselected options a
          visible border fixed the affordance and broke the selected state, which had been
          signalled by the border's mere presence — so it came to rest on a single step of
          paper tier. The current option now carries the brighter rule, the raised paper and
          full-strength ink; the rest sit at half-strength rule and `--ink-2`. */}
      <span className="text-muted-foreground">Or start from</span>
      {Object.entries(SAMPLE_BODIES).map(([key, { label }]) => {
        const current = key === sample;
        return (
          <Link
            key={key}
            href={`/new?sample=${key}`}
            aria-current={current ? "true" : undefined}
            className={
              current
                ? "border-rule-2 bg-card text-ink rounded-md border px-2.5 py-1"
                : "text-ink-2 hover:text-ink border-rule/50 hover:border-rule rounded-md border px-2.5 py-1 transition-colors"
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The form, or the receipt for a paste just saved.
 *
 * `?saved=<id>` IS THE SOURCE OF TRUTH for the save, not state inside the form, so the
 * heading above can disappear with it and every "New paste" link navigates away from a
 * different URL. `mayShowSavedReceipt` requires a paste that EXISTS and BELONGS TO THE
 * VIEWER: `isPasteId` is only a shape check, and on its own it let `?saved=zzzzzzzz`
 * render a complete receipt for a paste that never existed.
 */
async function FormOrReceipt({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string; saved?: string }>;
}) {
  const { saved, sample } = await searchParams;

  if (
    saved !== undefined &&
    isPasteId(saved) &&
    (await mayShowSavedReceipt(await getViewer(), saved))
  ) {
    // The receipt tells a guest what signing in would buy them. Resolved here rather
    // than inside the panel, which is a client component and has no viewer.
    const viewer = await getViewer();
    const guest =
      viewer.kind === "user" && isGuestUsername(viewer.user.username);

    // THE ABSOLUTE URL IS BUILT HERE, on the server, because only the server knows the
    // origin at render time. Deriving it in the client component produced a hydration
    // mismatch on every receipt — see `paste-url.ts`.
    const host = (await headers()).get("host");

    return (
      <SavedPanel
        id={saved}
        url={pasteUrl(saved, originFor(host))}
        guest={guest}
      />
    );
  }

  const preset = sample === undefined ? undefined : SAMPLE_BODIES[sample];

  // THE `key` IS WHAT MAKES THE SAMPLE LINKS WORK. `?sample=python` is the same route, so
  // clicking one is a client-side navigation: this component re-runs and sends a new
  // `initialBody`, but React reconciles `CreateForm` in place rather than remounting it —
  // and react-hook-form reads `defaultValues` only on the first render.
  return (
    <CreateForm
      key={sample ?? "blank"}
      now={NOW}
      initialBody={preset?.body}
      initialTitle={preset?.title}
      oversized={preset?.oversized}
    />
  );
}

function SamplesSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the samples"
      className="h-7 animate-pulse"
    />
  );
}

function FormSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the form"
      className="border-rule h-96 animate-pulse rounded-lg border"
    />
  );
}

export const metadata = {
  title: "New paste — Paste",
};
