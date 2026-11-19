// What a dead link answers with.
//
// 404 means "no idea what you are asking for"; 410 means "this existed, and it is
// gone on purpose". A human reading a two-year-old incident doc, a link checker and a
// crawler all need that difference and only one of them can ask (§6.3).

import { livenessFrom, type Liveness } from "@/lib/expiry/liveness";
import type { Paste } from "@/lib/types";

export type { Liveness } from "@/lib/expiry/liveness";

/**
 * Decides what a reader gets, for one domain paste.
 *
 * A thin wrapper over `livenessFrom`, which is the single definition shared with the
 * proxy's status decision and the SQL list filter. It used to be its own implementation
 * and omitted `state = 'redacted'`, so a redacted paste rendered its content under the
 * proxy's 410 — see `@/lib/expiry/liveness` for the whole story.
 */
export function livenessOf(paste: Paste, now = Date.now()): Liveness {
  return livenessFrom(paste, now);
}

/** Everything a reader of the citing document needs in order not to be stuck. */
export interface Tombstone {
  id: string;
  reason: Extract<Liveness, { kind: "gone" }>["reason"];
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
  reason: Tombstone["reason"],
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
    // A redaction replaces the body with a marker rather than destroying the row, so
    // unlike a purge the original bytes are genuinely gone while a newer revision exists.
    bytesGone: reason !== "expired",
  };
}
