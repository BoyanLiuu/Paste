import Link from "next/link";

import { Button } from "@/components/ui/button";
import { RETENTION } from "@/lib/expiry/retention";
import { shownOwner } from "@/lib/guest-handle";
import type { Tombstone } from "@/lib/expiry/tombstone";
import {
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
} from "@/lib/format";

// The 410 receipt (ux-50, 52, 53).
//
// No animation anywhere on this page. Its job is to be believed by someone reading a
// two-year-old ticket, and nothing on it should look generated (Appendix E).

const HEADLINE: Record<Tombstone["reason"], string> = {
  expired: "This snippet expired",
  purged: "This snippet is gone",
  removed: "This snippet was removed",
};

export function TombstoneView({ tombstone }: { tombstone: Tombstone }) {
  const t = tombstone;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground font-mono text-sm">
          410 Gone · /p/{t.id}
        </p>
        <h1 className="text-2xl">{HEADLINE[t.reason]}</h1>
        <p className="text-ink-2">
          {t.reason === "expired" ? (
            <>
              It lapsed on {formatDate(t.expiresAt!)}. The bytes are still here
              until {formatDate(t.purgeAfter!)}, so a moderator can still bring
              it back.
            </>
          ) : t.reason === "removed" ? (
            <>
              {t.removedBy?.who} removed it on {formatDate(t.removedBy!.at)}{" "}
              because of {t.removedBy?.reason.replaceAll("_", " ")}. The bytes
              are gone.
            </>
          ) : (
            <>
              It expired on {formatDate(t.expiresAt!)} and its bytes were purged
              on {formatDate(t.purgeAfter!)}.
            </>
          )}
        </p>
      </div>

      <dl className="border-rule grid grid-cols-1 gap-x-10 border-t pt-2 text-sm sm:grid-cols-2">
        <Row
          label="Created"
          // A GUEST'S HANDLE WAS PRINTED HERE IN FULL (M15), on the receipt of their own
          // expired paste — reachable by anyone who creates anonymously with an hour's
          // retention and waits. The view page's three guards all missed it because the
          // tombstone is a different component, which is why the decision lives in
          // `guest-handle.ts` rather than beside any one of them.
          value={`${formatDateTime(t.createdAt)} by ${shownOwner(t.owner)}`}
        />
        <Row label="Retention chosen" value={RETENTION[t.retention].label} />
        <Row
          label="Size"
          value={`${formatBytes(t.byteSize)} · ${formatCount(t.lineCount)} lines`}
        />
        <Row
          label="Purged"
          value={t.purgeAfter === null ? "—" : formatDate(t.purgeAfter)}
        />
        <Row
          label="SHA-256"
          value={`${t.sha256.slice(0, 8)}…${t.sha256.slice(-4)}`}
          mono
        />
      </dl>

      <p className="text-ink-2">
        The snippet is gone, but this URL will keep answering.
        {t.bytesGone ? (
          <>
            {" "}
            If you have a local copy, the hash above confirms it is the same
            text.
          </>
        ) : null}
      </p>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/new">Create a new paste</Link>
        </Button>
      </div>
    </div>
  );
}

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
