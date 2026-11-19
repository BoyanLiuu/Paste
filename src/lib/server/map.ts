// Prisma rows -> the domain types in src/lib/types.ts.
//
// This module is the seam ARCHITECTURE Appendix C promises. The screens were built in
// phase 1 against fixtures shaped like `Paste`; phase 2 has to produce that exact shape
// from the database or every component becomes a rewrite. So the mapping lives in one
// place and is asserted field-by-field against a fixture, rather than being spread
// across the queries that happen to need it.

import "server-only";

import type {
  LanguageSource,
  Paste,
  PasteState,
  RemovalReason,
  RetentionCode,
  Revision,
  Storage,
} from "@/lib/types";

/** The row shape the mapper needs: a paste with its revisions and its owner's username. */
export interface PasteRow {
  id: string;
  title: string | null;
  language: string;
  languageSource: string;
  lineNumbers: boolean;
  retentionCode: string;
  neverReason: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  purgeAfter: Date | null;
  state: string;
  forkedFrom: string | null;
  createdVia: string;
  viewCount: number;
  owner: { username: string };
  revisions: RevisionRow[];
  requests: RequestRow[];
}

/** Only the two statuses that are visible on a paste — see `removalOf`. */
export interface RequestRow {
  id: number;
  status: string;
  reasonCode: string;
  decidedAt: Date | null;
  decidedBy: { username: string } | null;
}

export interface RevisionRow {
  id: string;
  revisionNo: number;
  reason: string;
  sha256: string;
  byteSize: number;
  lineCount: number;
  bodyText: string | null;
  storageKey: string | null;
  createdAt: Date;
  purgedAt: Date | null;
  createdBy: { username: string };
}

/**
 * The ISO strings the components read.
 *
 * Every date crosses the RSC boundary, where a `Date` serialises but arrives as a
 * string anyway — so the domain type says `string` and the conversion happens here,
 * once, rather than being discovered per component.
 */
const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

/**
 * Build the domain object from a row and its revisions.
 *
 * The head revision is the highest `revision_no`, not the newest row: supersession
 * writes a new revision and stamps the old one, and ordering by `created_at` would pick
 * the wrong one for two revisions written inside the same transaction.
 */
export function toPaste(row: PasteRow): Paste {
  const revisions = [...row.revisions].sort(
    (a, b) => a.revisionNo - b.revisionNo,
  );
  const head = revisions.at(-1);
  const removal = removalOf(row.requests);

  if (head === undefined) {
    // Not defensive padding: a paste without a revision cannot be rendered, cannot be
    // tombstoned meaningfully and has no size. It means the create transaction committed
    // half of itself, which is impossible by construction — so say so loudly rather than
    // returning a `Paste` with zeroes that a screen will display as a 0-byte snippet.
    throw new Error(`Paste ${row.id} has no revisions.`);
  }

  return {
    id: row.id,
    owner: row.owner.username,
    title: row.title,
    language: row.language,
    languageSource: row.languageSource as LanguageSource,
    lineNumbers: row.lineNumbers,
    retention: row.retentionCode as RetentionCode,
    neverReason: row.neverReason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    purgeAfter: iso(row.purgeAfter),
    state: row.state as PasteState,
    removedBy: removal.removedBy,
    forkedFrom: row.forkedFrom,
    createdVia: row.createdVia as Paste["createdVia"],
    views: row.viewCount,
    byteSize: head.byteSize,
    lineCount: head.lineCount,
    body: head.bodyText,
    // How many of `lineCount` lines `body` actually holds. For an inline body that is
    // all of them; a body in object storage has none until M9 streams it, and the view
    // page already treats that as the truncated case.
    bodyShown: head.bodyText === null ? 0 : head.lineCount,
    storage: storageOf(head),
    revisions: revisions.map(toRevision),
    override: null,
    request: removal.request,
  };
}

/**
 * What a removal decision put on the face of the paste.
 *
 * WITHOUT THIS THE TOMBSTONE LIES. A moderator deletes a paste, so `state` becomes
 * `purged` and the 410 receipt takes its `purged` branch: "It expired on {expiresAt} and
 * its bytes were purged on {purgeAfter}". Neither happened. For a paste destroyed an hour
 * after it was written those are dates in the FUTURE, and for `retention: "never"` they are
 * null and render as 1 Jan 1970. The one screen whose whole job is to be believed by
 * someone reading a two-year-old ticket was printing a fabricated date — and the `removed`
 * branch that states the truth was unreachable, because this mapper returned a hardcoded
 * null through M11's own milestone.
 *
 * `removedBy` is set ONLY by a `deleted` decision, never by a redaction: `livenessFrom`
 * treats a non-null `removedBy` as gone, and a redacted paste serves its cleaned revision.
 *
 * A DENIED REQUEST LEAVES NOTHING. `request` drives the "under review" badge on the list
 * row, so carrying a denial there would mark a paste as under review permanently — after a
 * decision that deliberately changed nothing.
 */
function removalOf(requests: RequestRow[]): {
  removedBy: Paste["removedBy"];
  request: number | null;
} {
  // `decidedAt` is required rather than defaulted. One statement writes `status` and
  // `decided_at` together, so a `deleted` row without a timestamp cannot exist — and
  // defaulting it would print an epoch date on the screen this whole function exists to
  // stop printing fabricated dates.
  const deleted = requests.find(
    (r): r is RequestRow & { decidedAt: Date } =>
      r.status === "deleted" && r.decidedAt !== null,
  );
  const open = requests.find((r) => r.status === "open");

  if (deleted !== undefined) {
    return {
      removedBy: {
        // `decided_by` is SET NULL when a moderator's account goes, so the name can be
        // missing from a decision that definitely happened. The receipt still has to read
        // as a sentence.
        who: deleted.decidedBy?.username ?? "a moderator",
        at: deleted.decidedAt.toISOString(),
        reason: deleted.reasonCode as RemovalReason,
        request: deleted.id,
      },
      request: deleted.id,
    };
  }

  return { removedBy: null, request: open?.id ?? null };
}

/**
 * Where the bytes actually live, read from the pointer rather than recomputed from size.
 *
 * `storageFor(byteSize)` would give the same answer today and would be a lie the moment
 * the threshold moves: a paste stored inline under an old 1 MB threshold would start
 * claiming to be in object storage because its size now exceeds a newer one.
 */
function storageOf(revision: RevisionRow): Storage {
  return revision.storageKey !== null ? "object" : "postgres";
}

function toRevision(row: RevisionRow): Revision {
  return {
    no: row.revisionNo,
    reason: row.reason as Revision["reason"],
    sha256: row.sha256,
    byteSize: row.byteSize,
    lineCount: row.lineCount,
    createdBy: row.createdBy.username,
    createdAt: row.createdAt.toISOString(),
    purgedAt: iso(row.purgedAt),
  };
}

/**
 * The request statuses a reader can see, and therefore the only ones worth fetching.
 *
 * Mutable `string[]` rather than a `const` tuple because Prisma's generated `in` filter
 * rejects a readonly array, and the surrounding `as const` would make one.
 */
const VISIBLE_REQUEST_STATUSES: string[] = ["open", "deleted"];

/** The `include` every query needs to satisfy `PasteRow`. Shared so a new call site
 *  cannot forget a relation and fail at runtime inside the mapper. */
export const PASTE_INCLUDE = {
  owner: { select: { username: true } },
  revisions: {
    include: { createdBy: { select: { username: true } } },
    orderBy: { revisionNo: "asc" },
  },
  // Only the two statuses a reader can see, and newest first.
  //
  // `where` rather than fetching them all: a paste can collect any number of denied
  // requests, and none of them is visible on any screen. This keeps the extra read
  // proportional to what is displayed instead of to how often someone complained.
  //
  // Covered by `deletion_requests_by_paste`. Without that index this join is a sequential
  // scan of a table N8 sizes at 40 000 rows, on every paste read — which is why the index
  // and this include landed in the same change.
  requests: {
    where: { status: { in: VISIBLE_REQUEST_STATUSES } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      reasonCode: true,
      decidedAt: true,
      decidedBy: { select: { username: true } },
    },
  },
} as const;
