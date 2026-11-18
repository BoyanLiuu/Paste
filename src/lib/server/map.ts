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
    // M11 writes removal requests; until then no row can carry one, and inventing a
    // shape for it here would be guessing at a schema that does not exist yet.
    removedBy: null,
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
    request: null,
  };
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

/** The `include` every query needs to satisfy `PasteRow`. Shared so a new call site
 *  cannot forget a relation and fail at runtime inside the mapper. */
export const PASTE_INCLUDE = {
  owner: { select: { username: true } },
  revisions: {
    include: { createdBy: { select: { username: true } } },
    orderBy: { revisionNo: "asc" },
  },
} as const;
