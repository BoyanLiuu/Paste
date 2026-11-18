// What a dead link answers with.
//
// 404 means "no idea what you are asking for"; 410 means "this existed, and it is
// gone on purpose". A human reading a two-year-old incident doc, a link checker and a
// crawler all need that difference and only one of them can ask (§6.3).

import type { Paste } from "@/lib/types";

export type Liveness =
  /** Serve the content. */
  | { kind: "live" }
  /** 410 with a receipt. The bytes may or may not still exist; either way the reader
   *  gets the same shape of answer. */
  | { kind: "gone"; reason: "expired" | "purged" | "removed" };

/**
 * Decides what a reader gets, recomputing expiry rather than trusting `state`.
 *
 * This is the authoritative check (§6.3). The sweeper converges `state` on its own
 * schedule, so a paste whose `expires_at` has passed must answer 410 even while the
 * row still says "live" — which is exactly what lets the cron run daily instead of
 * every minute.
 */
export function livenessOf(paste: Paste, now = Date.now()): Liveness {
  if (paste.removedBy !== null) return { kind: "gone", reason: "removed" };
  if (paste.state === "purged") return { kind: "gone", reason: "purged" };

  const lapsed = paste.expiresAt !== null && Date.parse(paste.expiresAt) <= now;

  if (lapsed || paste.state === "expired") {
    // Past the purge date the bytes are gone too, whatever the sweeper has got to.
    const purged =
      paste.purgeAfter !== null && Date.parse(paste.purgeAfter) <= now;
    return { kind: "gone", reason: purged ? "purged" : "expired" };
  }

  return { kind: "live" };
}

/** Everything a reader of the citing document needs in order not to be stuck. */
export interface Tombstone {
  id: string;
  reason: "expired" | "purged" | "removed";
  owner: string;
  createdAt: string;
  expiresAt: string | null;
  purgeAfter: string | null;
  retention: Paste["retention"];
  byteSize: number;
  lineCount: number;
  /** Survives the purge, which is the point: if someone still has a local copy, this
   *  proves it is the same text. */
  sha256: string;
  removedBy: Paste["removedBy"];
  /** True once the bytes are actually gone rather than merely unreachable. */
  bytesGone: boolean;
}

export function tombstoneFor(
  paste: Paste,
  reason: "expired" | "purged" | "removed",
): Tombstone {
  const original = paste.revisions[0];
  return {
    id: paste.id,
    reason,
    owner: paste.owner,
    createdAt: paste.createdAt,
    expiresAt: paste.expiresAt,
    purgeAfter: paste.purgeAfter,
    retention: paste.retention,
    byteSize: original.byteSize,
    lineCount: original.lineCount,
    sha256: original.sha256,
    removedBy: paste.removedBy,
    bytesGone: reason !== "expired",
  };
}
