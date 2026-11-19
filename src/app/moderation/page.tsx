import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { RETENTION } from "@/lib/expiry/retention";
import { formatCount, formatDateTime } from "@/lib/format";
import { openRequests, VIEW_WINDOW_DAYS } from "@/lib/server/moderation";
import { getViewer } from "@/lib/server/session";
import { isModerator } from "@/lib/server/viewer";
import type { RemovalRequest } from "@/lib/types";

// GET /moderation — the queue (ux-37 – 41).
//
// MODERATOR ONLY, and it answers 404 rather than 403 to anyone else. A 403 confirms the
// page exists, which tells someone probing that this installation has a moderation surface
// and that they are not on it. `notFound()` says nothing.
//
// The queue is the whole point of the read: §6.3 names the 90-day view count as the
// decision input, because it is the only figure on the screen that says whether destroying
// a paste breaks something. It sits next to the justification for that reason.
//
// Inside Suspense because both the session and the query are request reads, and
// `cacheComponents` fails the build on either outside a boundary — the mistake that broke
// `/` when M10 wired Clerk.

export default async function Page() {
  return (
    <AppShell current="moderation">
      <Suspense fallback={<Loading />}>
        <Queue />
      </Suspense>
    </AppShell>
  );
}

async function Queue() {
  await connection();

  const viewer = await getViewer();
  // The gate, server-side. The nav link is absent for non-moderators, and that is
  // presentation — this is the thing that actually refuses.
  if (!isModerator(viewer)) notFound();

  const requests = await openRequests();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl">Removal requests</h1>
        <p className="text-ink-2 text-sm">
          {requests.length === 0
            ? "Nothing open."
            : `${formatCount(requests.length)} open, oldest first.`}{" "}
          The bias is toward keeping pastes: redaction removes the secret and leaves
          the link working.
        </p>
      </div>

      {requests.length === 0 ? (
        <EmptyQueue />
      ) : (
        <ul className="flex flex-col gap-4">
          {requests.map((request) => (
            <li key={request.id}>
              <RequestCard request={request} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestCard({ request }: { request: RemovalRequest }) {
  return (
    <article className="border-rule bg-card flex flex-col gap-3 rounded-lg border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base">
          <span className="text-muted-foreground font-mono text-sm">
            #{request.id}
          </span>{" "}
          <Link href={`/p/${request.pasteId}`} className="font-mono underline">
            /p/{request.pasteId}
          </Link>
        </h2>
        <p className="text-muted-foreground text-xs">
          opened {formatDateTime(request.openedAt)}
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
        <Row label="Requested by" value={request.requester} />
        <Row
          label="Claimed relationship"
          value={request.relationship.replaceAll("_", " ")}
        />
        <Row label="Reason" value={request.reason.replaceAll("_", " ")} />
        <Row
          // THE DECISION INPUT. Prominent rather than buried in a detail panel: a paste
          // nobody has read is cheap to destroy, and one read 400 times in the last month
          // is cited somewhere that will break.
          label={`Reads in ${VIEW_WINDOW_DAYS} days`}
          value={formatCount(request.views90)}
        />
      </dl>

      <blockquote className="border-rule text-ink-2 border-l-2 pl-3 text-sm">
        {request.justification}
      </blockquote>

      {request.audit.length > 0 ? (
        <details className="text-sm">
          <summary className="text-muted-foreground cursor-pointer">
            History ({request.audit.length})
          </summary>
          <ol className="mt-2 flex flex-col gap-1">
            {request.audit.map((entry, i) => (
              <li key={i} className="text-ink-2 flex flex-wrap gap-2">
                <span className="text-muted-foreground font-mono text-xs">
                  {formatDateTime(entry.at)}
                </span>
                <span>
                  <strong className="font-medium">{entry.actor}</strong>{" "}
                  {entry.detail}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {/* No decide buttons yet.

          Deciding is a Server Action with three outcomes, two of which destroy bytes, and
          the queue is readable and useful without them. Shipping the buttons in the same
          change as the queue would mean the first time anyone saw this screen was also the
          first time it could delete something. `decideRequest` is implemented and tested;
          what is missing is the form. */}
      <p className="text-muted-foreground text-xs">
        Decide from the paste page. Redaction removes the secret and keeps the
        link; deletion destroys the bytes and leaves a tombstone.
      </p>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyQueue() {
  return (
    <div className="border-rule text-ink-2 rounded-lg border border-dashed p-6 text-sm">
      <p>
        No open requests. Retention is the usual deletion mechanism —{" "}
        {RETENTION["30d"].label} by default — so most pastes leave without anyone
        deciding anything.
      </p>
    </div>
  );
}

function Loading() {
  return (
    <div
      className="border-rule h-64 animate-pulse rounded-lg border"
      aria-label="Loading the queue"
    />
  );
}

export const metadata = {
  title: "Removal requests — Paste",
};
