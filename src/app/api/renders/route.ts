// POST /api/renders — backfill missing renders. Driven by cron, never by a reader.
//
// WHY THIS IS NOT ON THE READ PATH.
//
// A render can be absent for a paste that should have one: the save-time render failed
// (M7 swallows that by design, because a grammar bug must not lose a saved paste), or a
// theme changed, or Shiki was upgraded. `paste_renders` is keyed on (revision, theme), so
// a new theme means every existing revision has no row for it.
//
// The obvious fix is to render on demand in `getRender`. That is precisely what N2
// forbids — "0 highlighter invocations on the read path" — and
// `view-route-imports.spec.ts` fails the build if Shiki enters the view route's graph.
// The reason is not purity: Shiki's warm-up is ~90 ms and its grammars are multi-megabyte
// WASM, so a lazy render moves that cost onto the hot path, where it is paid by every
// reader of a paste nobody has re-rendered yet.
//
// So the backfill lives here, out of band, and the view page keeps serving the escaped
// fallback until this has run. §6.2 is clear that silently serving unhighlighted text
// "reads as a bug", so the view page now says so for a small body — see
// `components/paste-view.tsx`. That banner is the honest half of this trade: the reader
// is told the colour is missing rather than left wondering.

import { NextResponse } from "next/server";

import { highlight, THEME_NAME } from "@/lib/render/highlight";
import { renderMode, renderWorthStoring } from "@/lib/render/thresholds";
import { prisma } from "@/lib/server/prisma";

/** Revisions per invocation. Bounded so one run cannot hold a connection for minutes;
 *  cron comes back, and the work is idempotent. */
const BATCH = 25;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    // Fail closed. An unauthenticated endpoint that invokes a highlighter is a way to
    // make the server do unbounded work on demand, which is the exact cost N2 is about.
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing to run." },
      { status: 503 },
    );
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const offered = request.headers.get("authorization");
  if (offered !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  // Candidates: a live-ish revision whose bytes are still present, with no render for the
  // current theme. `purgedAt: null` because a purged revision has no body to render and
  // must never get one back — the whole point of the purge.
  const candidates = await prisma.revision.findMany({
    where: {
      purgedAt: null,
      bodyText: { not: null },
      renders: { none: { theme: THEME_NAME } },
    },
    select: {
      id: true,
      bodyText: true,
      byteSize: true,
      lineCount: true,
      // `pasteId` is a column on the revision, so it is always present. The relation
      // below is a SECOND query — Prisma loads includes separately — which means a paste
      // deleted between the two comes back as `paste: null` on a revision that still
      // looks complete. Reporting used to read `revision.paste.id` and threw a TypeError
      // out of the whole endpoint when it did.
      pasteId: true,
      paste: { select: { language: true } },
    },
    // Oldest first, so a backlog drains in a predictable order rather than starving the
    // revisions at the far end of it.
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });

  let rendered = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const revision of candidates) {
    // Above the threshold there is no render by design (§6.2). These rows are candidates
    // by the query above — which only knows about absence — so the threshold is applied
    // here, and they are reported as skipped rather than failed.
    if (renderMode(revision.byteSize, revision.lineCount) !== "highlight") {
      skipped += 1;
      continue;
    }

    // The paste went away between the two queries the batch read takes. Nothing to
    // render, and nothing to report as broken.
    if (revision.paste === null) {
      skipped += 1;
      continue;
    }

    try {
      const html = await highlight(revision.bodyText!, revision.paste.language);
      if (html === null) {
        // No grammar for that language. Not an error: `language` can come straight from
        // an API caller, and the escaped fallback is a real rendering path.
        skipped += 1;
        continue;
      }

      // THE OUTPUT CAP, the same check the create path makes and through the same
      // function. A backfill that stored markup the create path would have refused would
      // reintroduce the budget breach by the back door — and quietly, since nothing on
      // the view page says which writer produced a render.
      if (!renderWorthStoring(html)) {
        skipped += 1;
        continue;
      }

      // `create`, not `upsert`. A row appearing between the query and here means another
      // invocation got there first, and the unique violation is the correct outcome —
      // overwriting would replace one valid render with an identical one, and mask the
      // fact that two runs are overlapping.
      await prisma.render.create({
        data: { revisionId: revision.id, theme: THEME_NAME, html },
      });
      rendered += 1;
    } catch (error) {
      // Both of these are races the design tolerates, not faults, and the window is wide
      // on purpose: the batch is read once and each body then takes a Shiki render to
      // produce, so there is real time between the query and this insert.
      //
      //   unique    another invocation rendered this revision first.
      //   foreign   the revision stopped existing — purged by the sweeper, removed by a
      //             moderator, or its paste deleted. Reporting that as a failure makes an
      //             operator chase a job that is behaving correctly, and it is the reason
      //             this is distinguished at all.
      if (isUniqueViolation(error) || isForeignKeyViolation(error)) {
        skipped += 1;
        continue;
      }
      // One genuinely bad revision must not abandon the rest of the batch.
      failed.push(revision.pasteId);
      console.error(`backfill failed for revision ${revision.id}`, error);
    }
  }

  // Logged inline. This was `after()` first, which needs a request scope and so made
  // the route uncallable from a test — a real cost, for deferring one console.log.
  console.log(
    `renders backfill: ${rendered} rendered, ${skipped} skipped, ${failed.length} failed`,
  );

  return NextResponse.json({
    examined: candidates.length,
    rendered,
    skipped,
    failed,
    // So cron, or a human, knows whether to come straight back.
    more: candidates.length === BATCH,
  });
}

function codeOf(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { code?: unknown }).code;
}

function isUniqueViolation(error: unknown): boolean {
  const code = codeOf(error);
  return code === "23505" || code === "P2002";
}

/** The revision disappeared between the batch query and the insert. */
function isForeignKeyViolation(error: unknown): boolean {
  const code = codeOf(error);
  return code === "23503" || code === "P2003";
}
