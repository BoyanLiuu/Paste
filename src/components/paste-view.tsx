import Link from "next/link";

import type { ForkProblem } from "@/lib/fork-problem";
import { CopyBody, CopyLink, RangeSelectMount } from "@/components/body-tools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
} from "@/lib/format";
import { RETENTION } from "@/lib/expiry/retention";
import { renderPlain, withLineIds } from "@/lib/render/gutter";
import { renderMode, TRUNCATE_LINES } from "@/lib/render/thresholds";
import { downloadUrl } from "@/lib/urls";
import type { Paste } from "@/lib/types";

// The view page's content. A Server Component with one client child, which attaches
// the range-selection listener and renders nothing (N11).
//
// Deliberately absent: a highlighter. The body arrives as HTML that was rendered once
// at save time, or as escaped plain text when it is over the §6.2 threshold. A test
// fails the build if `shiki` reaches this module's import graph.

const BODY_ID = "paste-body";

export function PasteView({
  paste,
  renderedHtml,
  forks,
  forkProblem = null,
}: {
  paste: Paste;
  /** Null when no render was stored — above the threshold, or purged. Not an error:
   *  the page falls back to escaped plain text, which is also what makes a stored
   *  render safe to delete. */
  renderedHtml: string | null;
  forks: Paste[];
  /** Why the last fork attempt was refused, from `?fork=`. The action redirects back
   *  here rather than rendering an error page, because the thing the reader wanted is
   *  this paste and it is still readable. */
  forkProblem?: ForkProblem | null;
}) {
  const mode = renderMode(paste.byteSize, paste.lineCount);
  const body = paste.body ?? "";

  // A stored render, or escaped plain text. The fallback is a real rendering path, not an
  // error state: it is the designed answer above the §6.2 threshold, and it is also what
  // a small paste gets while its render is missing — a failed save-time render, a theme
  // change, a Shiki upgrade. That second case is announced by a banner below, because
  // §6.2 is explicit that silently unhighlighted text reads as a bug. The backfill that
  // fixes it is `api/renders`, out of band, because N2 forbids rendering on a read.
  const html =
    renderedHtml !== null
      ? paste.lineNumbers
        ? withLineIds(renderedHtml)
        : renderedHtml
      : renderPlain(body, paste.lineNumbers);

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <nav className="text-muted-foreground text-sm">
          <Link href={`/list/${paste.owner}`} className="underline">
            {paste.owner}’s pastes
          </Link>
          <span aria-hidden="true"> / </span>
          <span>This paste</span>
        </nav>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl">
            {paste.title ?? <span className="font-mono">/p/{paste.id}</span>}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground font-mono">
              /p/{paste.id}
            </span>
            <StateBadge paste={paste} />
          </div>
        </div>

        {forkProblem !== null ? <ForkRefused problem={forkProblem} /> : null}
        {paste.state === "redacted" ? <RedactionNotice paste={paste} /> : null}
        {mode === "plain" ? (
          <Banner>
            Syntax highlighting is off — {formatCount(paste.lineCount)} lines.
          </Banner>
        ) : null}
        {mode === "highlight" && renderedHtml === null ? (
          <Banner>
            Syntax highlighting is not ready for this paste yet. The text below
            is complete.
          </Banner>
        ) : null}
        {mode === "truncated" ? (
          <Banner>
            Showing the first{" "}
            {formatCount(Math.min(paste.bodyShown, TRUNCATE_LINES))} of{" "}
            {formatCount(paste.lineCount)} lines.
          </Banner>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">{paste.language}</Badge>
          <span className="num text-muted-foreground text-sm">
            {formatCount(paste.lineCount)} lines, {formatBytes(paste.byteSize)}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Copy reads the DOM, not an endpoint. The line numbers are a CSS counter
                written with `::before`, so `innerText` leaves them out — which is why there
                is no cross-origin fetch here and, in turn, no inline raw endpoint to need a
                second domain. `body-tools.tsx` has the detail. */}
            <CopyLink />
            <CopyBody targetId={BODY_ID} />
            <Button asChild size="sm" variant="outline">
              {/* The bytes, as an attachment. `Content-Disposition: attachment` is what
                  keeps them from being rendered as a page — the property that replaced
                  §6.5's separate registrable domain. */}
              <a href={downloadUrl(paste.id)}>Download</a>
            </Button>
            {/* A plain form posting to a ROUTE, referenced by URL rather than imported.
                An imported server action would put the create path — and therefore Shiki —
                in this page's module graph, which N11 forbids and
                `view-route-imports.spec.ts` catches. It also means forking needs no client
                JavaScript on a page whose one client child attaches a selection listener.
                The route redirects to the new paste, or back here with `?fork=<reason>`. */}
            <form method="post" action={`/p/${paste.id}/fork`}>
              <Button type="submit" size="sm" variant="outline">
                Fork
              </Button>
            </form>
          </div>
        </div>

        {/* The body. `dangerouslySetInnerHTML` is the correct tool here and the name
            is doing its job: this is HTML the project generated, from text that was
            escaped before tokenisation. The hostile-content suite in M12 asserts that
            a body of `</pre><script>alert(1)</script>` executes nothing.

            data-line-count is the lines actually present, not the paste's total. A
            truncated paste holds only its first 500, so passing 214,880 would let
            #L1000 parse as valid while nothing on the page answers to it. */}
        <div
          id={BODY_ID}
          className="paste-body border-rule rounded-lg border"
          data-numbered={paste.lineNumbers ? "true" : "false"}
          data-line-count={Math.min(paste.lineCount, paste.bodyShown)}
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {paste.lineNumbers ? <RangeSelectMount targetId={BODY_ID} /> : null}

        {/* BELOW THE BODY AND UNDERSTATED, which is a judgement the design makes and worth
            keeping: removal is a request a human reads, and putting it next to Fork in the
            action row would make "report this" look like a feature of reading a snippet.
            §6.3's bias is toward keeping pastes. */}
        <p className="text-muted-foreground text-sm">
          {paste.request !== null ? (
            <>Request #{paste.request} is open on this paste. </>
          ) : null}
          <Link href={`/p/${paste.id}/request-removal`} className="underline">
            Request removal
          </Link>
        </p>
      </div>

      <aside className="flex flex-col gap-6">
        <Expiry paste={paste} />
        <Metadata paste={paste} />
        {paste.lineNumbers ? <LinkToLines /> : null}
        <WhatThisAnswers paste={paste} />
        <Forks paste={paste} forks={forks} />
      </aside>
    </div>
  );
}

function StateBadge({ paste }: { paste: Paste }) {
  if (paste.state === "live") return <Badge variant="secondary">Live</Badge>;
  if (paste.state === "redacted") return <Badge>Revision 2</Badge>;
  return <Badge variant="destructive">{paste.state}</Badge>;
}

function Banner({
  children,
  role,
}: {
  children: React.ReactNode;
  role?: "status";
}) {
  return (
    <p
      role={role}
      className="border-rule bg-card text-ink-2 rounded-lg border px-4 py-3 text-sm"
    >
      {children}
    </p>
  );
}

/**
 * Why the fork was refused, on the page the reader is still looking at.
 *
 * THE BLOCKED CASE IS THE AWKWARD ONE and it has to be said plainly: the scanner's rules
 * grow, so a paste accepted months ago can fail today's scan — and the fork is refused
 * while the original sits right there, readable. That looks like a contradiction unless
 * someone explains it, and the explanation is §6.3's: the source is grandfathered because
 * destroying it is a moderator's decision with its own queue, and a new paste has no such
 * claim. Without this text the reader's reasonable conclusion is that forking is broken.
 */
function ForkRefused({ problem }: { problem: ForkProblem }) {
  const message: Record<ForkProblem, string> = {
    blocked:
      "The fork was refused: the scanner found a credential in this text. A fork is a new paste, so it is scanned with today’s rules — which can catch something that was allowed when this paste was written. The original is unchanged, because removing it is a separate decision.",
    override:
      "The fork was refused: the scanner flagged something that needs a justification. Copy the text into a new paste, where you can review the finding and say why it is safe.",
    gone: "There is nothing to fork: this paste’s bytes have been removed.",
    signin: "Sign in to fork a paste.",
    failed: "The fork did not go through. Nothing was created — try again.",
  };

  // The same banner every other notice on this page uses. A refusal does not need its own
  // visual language — the sentence says it was refused, and an accent stripe on one card
  // would be the only one in the product.
  return <Banner role="status">{message[problem]}</Banner>;
}

function RedactionNotice({ paste }: { paste: Paste }) {
  const redaction = paste.revisions.find((r) => r.reason === "redaction");
  const original = paste.revisions.find((r) => r.reason === "original");
  if (redaction === undefined || original === undefined) return null;
  return (
    // Permanent and visible, not a toast. A silent redaction is strictly worse than
    // no redaction, because it makes every other paste's content unverifiable (§6.3).
    <div className="border-rule bg-brand-soft/40 flex flex-col gap-1 rounded-lg border px-4 py-3 text-sm">
      <p>
        <strong>Revision {redaction.no}</strong> — a secret was redacted on{" "}
        {formatDate(redaction.createdAt)} by {redaction.createdBy}.
      </p>
      <p className="text-muted-foreground">
        Revision {original.no}’s bytes are gone. Its SHA-256 was{" "}
        <span className="font-mono">{original.sha256.slice(0, 8)}…</span>, so a
        local copy can still be checked against what was here.
      </p>
    </div>
  );
}

function Expiry({ paste }: { paste: Paste }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-muted-foreground font-mono text-xs">Expires</p>
      <p className="num font-mono text-2xl">
        {paste.expiresAt === null ? "Never" : formatDate(paste.expiresAt)}
      </p>
      <p className="text-muted-foreground text-sm">
        {paste.expiresAt === null ? (
          (paste.neverReason ?? "Nothing removes this one.")
        ) : (
          <>
            {formatDateTime(paste.expiresAt).split(", ")[1]}. Chosen at save:{" "}
            {RETENTION[paste.retention].label}.
          </>
        )}
      </p>
    </div>
  );
}

function Metadata({ paste }: { paste: Paste }) {
  const head = paste.revisions.at(-1)!;
  return (
    <dl className="border-rule flex flex-col border-t text-sm">
      <Row label="Owner" value={paste.owner} />
      <Row
        label="Language"
        value={`${paste.language} from ${SOURCE_LABEL[paste.languageSource]}`}
      />
      <Row label="Size" value={formatBytes(paste.byteSize)} />
      <Row label="Lines" value={formatCount(paste.lineCount)} />
      <Row label="Revision" value={String(head.no)} />
      <Row
        label="SHA-256"
        value={`${head.sha256.slice(0, 8)}…${head.sha256.slice(-4)}`}
        mono
      />
      <Row label="Views" value={formatCount(paste.views)} />
      <Row label="Made with" value={VIA_LABEL[paste.createdVia]} />
      <Row
        label="Stored in"
        value={paste.storage === "postgres" ? "the database" : "object storage"}
      />
    </dl>
  );
}

const SOURCE_LABEL: Record<Paste["languageSource"], string> = {
  explicit: "an explicit choice",
  filename: "the filename",
  firstline: "the first line",
  scored: "a scored guess",
  fallback: "nothing — it fell back",
};

const VIA_LABEL: Record<Paste["createdVia"], string> = {
  web: "the web form",
  // No `cli` entry: the command-line client was dropped, and `Record` over the union means
  // a stale key here would be a type error rather than dead code nobody notices.
  api: "the API",
};

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border-rule flex items-baseline justify-between gap-4 border-b py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-right"}>{value}</dd>
    </div>
  );
}

function LinkToLines() {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-md">Link to lines</h2>
      <div className="flex gap-2">
        {/* Mirrors the fragment; the fragment is the source of truth. Read-only
            because the URL is the control — typing here would be a second way to say
            the same thing, and the two would disagree. */}
        <Input
          id="line-range"
          readOnly
          placeholder="L12"
          className="font-mono"
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Click a line number, then shift-click another to extend. The fragment
        never reaches the server.
      </p>
    </div>
  );
}

function WhatThisAnswers({ paste }: { paste: Paste }) {
  const head = paste.revisions.at(-1)!;
  const events: { id: string; at: string; text: React.ReactNode }[] = [
    {
      id: "saved",
      at: paste.createdAt,
      text: (
        <>
          Saved as revision {paste.revisions[0].no}. By{" "}
          {paste.revisions[0].createdBy}.
        </>
      ),
    },
  ];

  if (head.reason === "redaction") {
    events.push({
      id: "redacted",
      at: head.createdAt,
      text: <>Redacted by {head.createdBy}. The link kept working.</>,
    });
  }

  if (paste.expiresAt !== null) {
    events.push({
      id: "expires",
      at: paste.expiresAt,
      text: <>Expires. The link answers 410 with a receipt, never a 404.</>,
    });
  }
  if (paste.purgeAfter !== null) {
    events.push({
      id: "purge",
      at: paste.purgeAfter,
      text: <>Bytes purge. The hash, size and owner stay.</>,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-md">What this link answers</h2>
      <ol className="border-rule flex flex-col gap-3 border-l pl-4 text-sm">
        {events.map((event) => (
          <li key={event.id} className="flex flex-col">
            <span className="text-cool font-mono text-xs">
              {formatDateTime(event.at)}
            </span>
            <span className="text-ink-2">{event.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Forks({ paste, forks }: { paste: Paste; forks: Paste[] }) {
  if (paste.forkedFrom === null && forks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {/* A border, not shadcn's <Separator />: that wraps Radix and is a client
          component, so importing it put a second JS bundle on the page that renders
          hostile content. The module-graph test caught it on its first run. */}
      <hr className="border-rule" />
      <h2 className="text-md">Forks</h2>
      {paste.forkedFrom !== null ? (
        <p className="text-sm">
          Forked from{" "}
          <Link href={`/p/${paste.forkedFrom}`} className="font-mono underline">
            /p/{paste.forkedFrom}
          </Link>
        </p>
      ) : null}
      {forks.map((fork) => (
        <p key={fork.id} className="text-sm">
          <Link href={`/p/${fork.id}`} className="font-mono underline">
            /p/{fork.id}
          </Link>{" "}
          by {fork.owner}, {formatDate(fork.createdAt)}
        </p>
      ))}
      {paste.forkedFrom === null && forks.length === 0 ? (
        <p className="text-muted-foreground text-sm">No forks yet.</p>
      ) : null}
    </div>
  );
}
