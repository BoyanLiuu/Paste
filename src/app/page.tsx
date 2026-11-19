import { Suspense } from "react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CreateForm } from "@/components/create-form";
import { Button } from "@/components/ui/button";
import { NOW } from "@/lib/fixtures";
import { SAMPLE_BODIES } from "@/lib/samples";
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
  searchParams: Promise<{ sample?: string }>;
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
              <a href="#new">New paste</a>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/?sample=python#new">Open a sample paste</Link>
            </Button>
          </div>
        </section>

        <section id="new" className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl">New paste</h2>
            <p className="text-muted-foreground">
              Pick how long it lives now. There is no delete button later.
            </p>
          </div>

          <Suspense fallback={<FormSkeleton />}>
            <PresetForm searchParams={searchParams} />
          </Suspense>
        </section>
      </div>
    </AppShell>
  );
}

/** Reads ?sample= so every designed state is reachable by URL rather than by typing
 *  the right thing. Separated so only this subtree depends on the request. */
async function PresetForm({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string }>;
}) {
  const { sample } = await searchParams;
  const preset = sample === undefined ? undefined : SAMPLE_BODIES[sample];

  // `now` is fixed on the server, so the expiry panel and the eventual save cannot
  // disagree and the screen is deterministic to screenshot.
  return (
    <CreateForm
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
