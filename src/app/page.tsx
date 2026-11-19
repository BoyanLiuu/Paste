import { Suspense } from "react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CreateForm } from "@/components/create-form";
import { SavedPanel } from "@/components/create-receipt";
import { isPasteId } from "@/lib/ids";
import { Button } from "@/components/ui/button";
import { NOW } from "@/lib/fixtures";
import { SAMPLE_BODIES } from "@/lib/samples";
import { mayShowSavedReceipt } from "@/lib/server/saved-receipt";
import { getViewer } from "@/lib/server/session";

// The create screen (ux-01 – ux-12). Public: it renders for a signed-out visitor, and
// M10 makes submitting prompt sign-in rather than the route refusing to load (§3).
//
// `cacheComponents` is on, so reading searchParams has to sit inside a Suspense
// boundary — the shell and the hero prerender, and only the request-dependent part
// streams. M10 brings the same constraint to getViewer() once it reads Clerk's cookies
// instead of a fixture, so the boundary is already where it will be needed.

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string; saved?: string }>;
}) {
  return (
    <AppShell current="new">
      <div className="flex flex-col gap-16">
        <section className="flex flex-col gap-6">
          <h1 className="text-3xl">
            Paste once.
            <br />
            The link keeps answering.
          </h1>
          <p className="text-ink-2 max-w-md text-lg">
            Secrets are caught before saving; redaction and expiry never break
            the link.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              {/* `/#new`, NOT `#new`. A bare fragment is a same-page jump: from
                  `/?sample=python` it scrolled to the form and left the sample sitting in
                  it, so "New paste" gave you somebody else's text. With the path in front
                  of it this is a real navigation, the `key` below changes, and the form
                  remounts empty — which is what the control says it does. On `/` itself
                  the behaviour is unchanged: still just a scroll. */}
              <Link href="/#new">New paste</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/?sample=python#new">Open a sample paste</Link>
            </Button>
          </div>
        </section>

        {/* THE HEADING BELONGS TO THE FORM and disappears with it. After a save it told
            the reader to "pick how long it lives now" about a paste that was already
            saved and whose retention was already chosen — stale instructions above a
            receipt. Both live inside the same Suspense boundary now, so whichever one
            `?saved=` selects brings its own heading. */}
        <section id="new" className="flex flex-col gap-6">
          <Suspense fallback={<FormSkeleton />}>
            <FormOrReceipt searchParams={searchParams} />
          </Suspense>
        </section>
      </div>
    </AppShell>
  );
}

/**
 * The form, or the receipt for a paste just saved.
 *
 * `?saved=<id>` IS THE SOURCE OF TRUTH for the save, rather than state inside the form.
 * Holding it in the form caused two defects: this page's heading could not see it and sat
 * above the receipt with stale instructions, and "New paste" in the hero and the nav are
 * links to `/` and `/#new` — which from `/` are not navigations at all, so they changed
 * the address bar and left the receipt on screen. With the id on the URL, every one of
 * those links leads away from a different URL and lands on a fresh form.
 *
 * THE ID IS VERIFIED, not merely shape-checked, and the first version of this got it
 * wrong. `isPasteId` only says the string looks like an id we could have issued, so
 * `?saved=zzzzzzzz` rendered a complete "Saved." panel for a paste that never existed,
 * with a "View paste" button that answered 404 — and `?saved=<anyone else's id>` rendered
 * one asserting you had saved somebody else's paste. That is the forged receipt §6.3
 * refuses for tombstones, reached from the other end: the reason an unknown id answers 404
 * rather than 410 is precisely so nobody can mint a plausible screenshot.
 *
 * So the panel renders only for a paste that EXISTS and BELONGS TO THE VIEWER. The query
 * costs one read and only on the rare request that carries the parameter. An anon viewer
 * never passes it, which is right: saving needs a session, so a signed-out visitor cannot
 * have saved anything.
 */
async function FormOrReceipt({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string; saved?: string }>;
}) {
  const { saved } = await searchParams;

  if (
    saved !== undefined &&
    isPasteId(saved) &&
    (await mayShowSavedReceipt(await getViewer(), saved))
  ) {
    return <SavedPanel id={saved} />;
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="text-xl">New paste</h2>
        <p className="text-muted-foreground">
          Pick how long it lives now. There is no delete button later.
        </p>
      </div>
      <PresetForm searchParams={searchParams} />
    </>
  );
}

/** Reads ?sample= so every designed state is reachable by URL rather than by typing
 *  the right thing. Separated so only this subtree depends on the request. */
async function PresetForm({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string; saved?: string }>;
}) {
  const { sample } = await searchParams;
  const preset = sample === undefined ? undefined : SAMPLE_BODIES[sample];

  // `now` is fixed on the server, so the expiry panel and the eventual save cannot
  // disagree and the screen is deterministic to screenshot.
  //
  // THE `key` IS WHAT MAKES THE SAMPLE LINKS WORK, and without it they silently did not.
  // `/?sample=python` is the same route, so clicking a sample link is a client-side
  // navigation: this server component re-runs and sends a new `initialBody`, but React
  // reconciles `CreateForm` in place rather than remounting it — and react-hook-form reads
  // `defaultValues` only on the first render. The URL changed, the prop changed, and the
  // textarea stayed empty. `create-form.tsx` even documents that RHF reads defaults once;
  // what nobody noticed is that the prop can change afterwards.
  //
  // Keying on the sample remounts the form, which is exactly the semantics of picking a
  // sample: replace what is in the box. The alternative — `form.reset()` in an effect —
  // does the same thing with an extra render and a dependency array to get wrong.
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

function FormSkeleton() {
  return (
    <div
      className="border-rule h-96 animate-pulse rounded-lg border"
      aria-hidden="true"
    />
  );
}
