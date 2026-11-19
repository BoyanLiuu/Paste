import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { RemovalForm } from "@/components/removal-form";
import { livenessOf } from "@/lib/expiry/tombstone";
import { formatBytes, formatCount } from "@/lib/format";
import { getPaste } from "@/lib/server/paste-service";
import { getViewer } from "@/lib/server/session";

// GET /p/:id/request-removal — asking for a paste to be removed (ux-34 – 36).
//
// A ROUTE RATHER THAN A DIALOG, which is what the design specifies and is right for the
// reason the whole feature exists: this is a request a human reads, with a justification
// that ends up in an audit record, and it should not be something anyone completes by
// accident in a popover over the thing they are complaining about.
//
// A GONE PASTE 404s HERE rather than offering the form. There is nothing to request —
// expiry already did it, and a request against a purged paste is an item in a queue whose
// only cost is attention. `/p/:id` keeps answering with its tombstone; this does not.
//
// Inside Suspense because the viewer and the paste are both request reads, and
// `cacheComponents` fails the build on either outside a boundary.

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AppShell current={null}>
      <Suspense fallback={<Loading />}>
        <Content params={params} />
      </Suspense>
    </AppShell>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await connection();

  const { id } = await params;
  const viewer = await getViewer();
  const paste = await getPaste(viewer, id);

  if (paste === null) notFound();
  if (livenessOf(paste).kind === "gone") notFound();

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <nav className="text-muted-foreground text-sm">
          <Link href={`/p/${paste.id}`} className="underline">
            {paste.title ?? `/p/${paste.id}`}
          </Link>
          <span aria-hidden="true"> / </span>
          <span>Request removal</span>
        </nav>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl">Ask for this paste to be removed</h1>
          <p className="text-ink-2">
            There’s no delete button. A moderator reads every request, and most
            end with the paste kept or a secret redacted.
          </p>
        </div>

        {paste.request !== null ? (
          <p className="border-rule bg-card rounded-md border p-3 text-sm">
            Request #{paste.request} is already open on this paste. Sending
            another adds nothing — a moderator is going to read that one.
          </p>
        ) : null}

        <RemovalForm pasteId={paste.id} />
      </div>

      <aside className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm">The paste</h2>
          <div className="border-rule bg-card flex flex-col gap-1 rounded-lg border p-4">
            <p>{paste.title ?? "Untitled"}</p>
            <p className="text-muted-foreground font-mono text-sm">
              /p/{paste.id}
            </p>
            <p className="text-muted-foreground text-sm">
              {paste.language} · {formatCount(paste.lineCount)} lines ·{" "}
              {formatBytes(paste.byteSize)} · by {paste.owner}
            </p>
          </div>
        </section>

        <Outcomes />
      </aside>
    </div>
  );
}

/**
 * What a moderator can do, stated before the request is sent.
 *
 * On the form on purpose: the three outcomes are the whole shape of the answer they are
 * about to wait for, and "the link keeps working" is the one thing a person asking for a
 * removal does not expect. Finding that out after sending is how a reasonable request
 * turns into a complaint about the decision.
 */
function Outcomes() {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-muted-foreground text-sm">
        What a moderator can do
      </h2>
      <dl className="border-rule bg-card flex flex-col gap-3 rounded-lg border p-4 text-sm">
        <div>
          <dt className="font-medium">Redact</dt>
          <dd className="text-ink-2">
            Replace the matched text. The link keeps working and says so.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Delete</dt>
          <dd className="text-ink-2">
            Purge the bytes now. The link answers 410 with a notice.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Deny</dt>
          <dd className="text-ink-2">
            Keep it, with a note back to you. The common answer.
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Loading() {
  return (
    <div
      className="border-rule h-96 animate-pulse rounded-lg border"
      aria-label="Loading the request form"
    />
  );
}

export const metadata = {
  title: "Request removal — Paste",
};
