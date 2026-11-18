import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { PasteView } from "@/components/paste-view";
import { TombstoneView } from "@/components/tombstone";
import { livenessOf, tombstoneFor } from "@/lib/expiry/tombstone";
import { PASTES } from "@/lib/fixtures";
import { revisionKey } from "@/lib/render/keys";
import { getPaste, getRender } from "@/lib/server/paste-service";
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
    // KNOWN GAP, closed in M8. Next has no API for a page to return 410 — there is
    // notFound() for 404 and nothing for Gone — so this renders the receipt with a 200
    // status. The content is right and the reader is not stuck, but a link checker
    // sees a live page. /raw/:id and /dl/:id already answer a real 410, so the
    // behaviour §6.3 depends on is demonstrable today; acceptance test 2 checks the
    // page itself with `curl -i`, and that is M8's.
    return <TombstoneView tombstone={tombstoneFor(paste, liveness.reason)} />;
  }

  const stored = await getRender(
    revisionKey(paste.id, paste.revisions.at(-1)!.no),
  );
  const forks = PASTES.filter((p) => p.forkedFrom === paste.id);

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
  const { id } = await params;
  const paste = await getPaste({ kind: "anon" }, id);
  if (paste === null) return { title: "Not found — Paste" };
  return {
    title: `${paste.title ?? `/p/${paste.id}`} — Paste`,
    // The body is attacker-supplied, so it never goes in a meta description.
    description: `A ${paste.language} snippet, ${paste.lineCount} lines.`,
  };
}
