import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { livenessOf } from "@/lib/expiry/tombstone";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import { expiryPhrase } from "@/lib/relative-time";
import type { Paste } from "@/lib/types";

// One row of /list/:username (ux-28).
//
// The expiry column is the point of the row. Someone scanning their pastes is deciding
// what is about to disappear, so a paste within two days of lapsing says "In 21 hours"
// and anything further out shows its date — see lib/relative-time.ts.

/** "Expired 6 Nov", "Purged 9 Oct", "Removed 8 Nov".
 *
 *  The date is the useful half: someone scanning a list of gone pastes is asking when
 *  each stopped answering. A bare "Purged" drops exactly that. */
function goneLabel(
  paste: Paste,
  reason: "expired" | "purged" | "removed",
): string {
  switch (reason) {
    case "removed":
      return `Removed ${formatDate(paste.removedBy!.at)}`;
    case "purged":
      return paste.purgeAfter === null
        ? "Purged"
        : `Purged ${formatDate(paste.purgeAfter)}`;
    case "expired":
      return paste.expiresAt === null
        ? "Expired"
        : `Expired ${formatDate(paste.expiresAt)}`;
  }
}

export function PasteRow({ paste }: { paste: Paste }) {
  const liveness = livenessOf(paste);
  const gone = liveness.kind === "gone";
  const expiry = expiryPhrase(paste.expiresAt);

  return (
    <tr className={gone ? "text-muted-foreground" : undefined}>
      <td className="py-3 pr-4 align-top">
        <Link href={`/p/${paste.id}`} className="flex flex-col gap-0.5">
          <span className={gone ? "" : "text-ink"}>
            {paste.title ?? "Untitled"}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            /p/{paste.id}
          </span>
        </Link>
      </td>
      <td className="py-3 pr-4 align-top">{paste.language}</td>
      <td className="num py-3 pr-4 text-right align-top">
        {formatCount(paste.lineCount)}
      </td>
      <td className="num py-3 pr-4 text-right align-top whitespace-nowrap">
        {formatBytes(paste.byteSize)}
      </td>
      <td className="py-3 pr-4 align-top whitespace-nowrap">
        {formatDate(paste.createdAt)}
      </td>
      <td className="py-3 pr-4 align-top">
        <div className="flex flex-wrap items-center gap-2">
          {gone ? (
            <Badge variant="secondary">
              {goneLabel(paste, liveness.reason)}
            </Badge>
          ) : (
            <span
              className={
                expiry.urgent
                  ? "text-cool whitespace-nowrap"
                  : "whitespace-nowrap"
              }
            >
              {expiry.text}
            </span>
          )}
          {paste.state === "redacted" ? <Badge>Redacted</Badge> : null}
          {paste.request !== null && !gone ? (
            <Badge variant="outline">Removal asked</Badge>
          ) : null}
        </div>
      </td>
      <td className="num py-3 text-right align-top">
        {formatCount(paste.views)}
      </td>
    </tr>
  );
}
