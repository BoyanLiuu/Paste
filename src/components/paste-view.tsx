import Link from "next/link";

import { RangeSelectMount } from "@/components/range-select-mount";
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
import { rawUrl, downloadUrl } from "@/lib/urls";
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
}: {
  paste: Paste;
  /** Null when no render was stored — above the threshold, or purged. Not an error:
   *  the page falls back to escaped plain text, which is also what makes a stored
   *  render safe to delete. */
  renderedHtml: string | null;
  forks: Paste[];
}) {
  const mode = renderMode(paste.byteSize, paste.lineCount);
  const body = paste.body ?? "";

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

        {paste.state === "redacted" ? <RedactionNotice paste={paste} /> : null}
        {mode === "plain" ? (
          <Banner>
            Syntax highlighting is off — {formatCount(paste.lineCount)} lines.
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
          <div className="ml-auto flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              {/* The raw endpoint, not the DOM: numbers rendered as text would be
                  captured by a copy, and the raw bytes are the canonical content. */}
              <a href={rawUrl(paste.id)}>Raw</a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={downloadUrl(paste.id)}>Download</a>
            </Button>
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

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-rule bg-card text-ink-2 rounded-lg border px-4 py-3 text-sm">
      {children}
    </p>
  );
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
  cli: "the command line",
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
