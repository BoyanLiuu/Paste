import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { PasteView } from "@/components/paste-view";
import { TombstoneView } from "@/components/tombstone";
import { livenessOf, tombstoneFor } from "@/lib/expiry/tombstone";
import {
  getForks,
  getPaste,
  getPasteMeta,
  getRenderForPaste,
} from "@/lib/server/paste-service";
import { getViewer } from "@/lib/server/viewer";

// GET /p/:id — the hot path (ux-14 – ux-27, ux-50, 52, 53, 54).
//
// Three answers, and the difference between the last two is the point of the product:
//
//   content   the paste is live
//   410       it existed and is gone on purpose — expired, purged or removed
//   404       no paste has ever had this id
//
// A 404 for a lapsed paste would break every document that cites the link; a 410 for
// an id that never existed would let anyone mint a plausible-looking receipt for a
// paste that never was.
//
// The content sits inside Suspense because it is dynamic twice over: it depends on the
// id, and §6.3 requires expiry be recomputed against the current time on every read
// rather than trusted from `state`. With `cacheComponents` on, both are runtime reads
// and prerendering fails outright without the boundary — which is the right answer
// here, not a workaround.
//
// This module must never import a highlighter. The body is HTML rendered once at save
// time, or escaped plain text above the threshold — `view-route-imports.spec.ts` fails
// the build if `shiki` or `motion` reaches this graph.

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await getViewer();
  return (
    <AppShell viewer={viewer} current={null}>
      <Suspense fallback={<Loading />}>
        <Content params={params} />
      </Suspense>
    </AppShell>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  // Declares this render request-time. §6.3 requires expiry be recomputed against the
  // real clock on every read rather than trusted from `state`, so livenessOf() calls
  // Date.now() — and under `cacheComponents` reading the clock while prerendering is
  // an error, not a warning. Without this the body rendered empty.
  await connection();

  const { id } = await params;
  const viewer = await getViewer();
  const paste = await getPaste(viewer, id);

  // Never existed. The one true 404.
  if (paste === null) notFound();

  const liveness = livenessOf(paste);

  if (liveness.kind === "gone") {
    // The status is 410, set by the proxy rather than here.
    //
    // Next gives a page no way to do it: `notFound()` is the only status API, and the
    // mechanism behind `forbidden()`/`unauthorized()` validates against a hardcoded
    // `{401, 403, 404}`. The route is also partially prerendered, so even a rewrite
    // carrying a status is answered by the shell's own 200 — which means this component
    // deciding "gone" cannot influence the status line at all. `src/proxy.ts` makes the
    // same determination before rendering starts and re-wraps this response.
    //
    // The determination is duplicated, so `expiry-on-read.spec.ts` asserts the two agree.
    // Disagreement would mean a 410 serving content, or a 200 serving a tombstone.
    return <TombstoneView tombstone={tombstoneFor(paste, liveness.reason)} />;
  }

  // In parallel: neither depends on the other, and serialising them would add a round
  // trip to the hot path for no reason.
  const [stored, forks] = await Promise.all([
    getRenderForPaste(viewer, paste.id),
    getForks(viewer, paste.id),
  ]);

  return <PasteView paste={paste} renderedHtml={stored} forks={forks} />;
}

function Loading() {
  // ux-15. Deliberately plain: this page's job is to show text, and a shimmer that
  // outlives the content it replaces is worse than a blank box.
  return (
    <div
      className="border-rule h-96 animate-pulse rounded-lg border"
      aria-label="Loading the paste"
    />
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Declares the metadata request-time, for the same reason `Content` does.
  //
  // From M8 this reads the database, and Prisma touches the clock while decoding
  // timestamps. Under `cacheComponents` any clock read during a prerender is an error, so
  // the static shell was abandoned with "encountered the unstable value `new Date()`" on
  // every view — and the route then re-rendered dynamically, which is why one page view
  // issued two identical full queries. Silent except in the server log, and it made the
  // duplicate read look like a caching failure rather than a retried render.
  await connection();

  const { id } = await params;
  const meta = await getPasteMeta({ kind: "anon" }, id);
  if (meta === null) return { title: "Not found — Paste" };
  return {
    title: `${meta.title ?? `/p/${meta.id}`} — Paste`,
    // The body is attacker-supplied, so it never goes in a meta description.
    description: `A ${meta.language} snippet, ${meta.lineCount} lines.`,
  };
}
