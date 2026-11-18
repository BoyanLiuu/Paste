// The only path any screen uses to reach data (ARCHITECTURE Appendix C).
//
// Phase 1 reads src/lib/fixtures; M7–M8 replace these bodies with Prisma queries. The
// signatures do not change, which is the whole point: every function is already
// `async`, and every function that can be owner-scoped already takes the viewer first.
//
// Server-only. Importing this from a client component should fail loudly rather than
// bundle the fixture bodies into the browser.

import "server-only";

import { PASTES, PASTES_BY_ID } from "@/lib/fixtures";
import { RENDERS } from "@/lib/fixtures/renders.generated";
import { DEFAULT_THEME, renderKey } from "@/lib/render/keys";
import { livenessOf } from "@/lib/expiry/tombstone";
import type { Cursor, Page, Paste, Viewer } from "@/lib/types";

/** Rows per page on /list/:username. Keyset, so this is a slice size, not an offset. */
export const PAGE_SIZE = 50;

/**
 * One paste by id, or null when no paste has ever had that id.
 *
 * Returns the row whatever its state. **Callers must not treat a returned paste as
 * readable**: expiry is recomputed on the read path (§6.3), so the page decides between
 * content, a 410 tombstone and a 404. Putting that decision here would hide it.
 */
export async function getPaste(
  _viewer: Viewer,
  id: string,
): Promise<Paste | null> {
  return PASTES_BY_ID[id] ?? null;
}

/**
 * The stored HTML for a revision, or null when none was rendered.
 *
 * A null is a legitimate answer, not an error: bodies above the §6.2 threshold never
 * get a render, and a purge deletes one. The view page must fall back to escaped plain
 * text, which is also what keeps the stored render safe to delete.
 */
export async function getRender(
  revisionId: string,
  theme = DEFAULT_THEME,
): Promise<string | null> {
  return RENDERS[renderKey(revisionId, theme)] ?? null;
}

/**
 * The raw body, as the raw origin and the copy button read it.
 *
 * For a truncated paste this is only the first `bodyShown` lines — phase 2 streams the
 * whole object instead. Null once purged.
 */
export async function getRaw(
  _viewer: Viewer,
  id: string,
): Promise<string | null> {
  return PASTES_BY_ID[id]?.body ?? null;
}

export type ListFilter = "all" | "live" | "gone";

export interface ListOptions {
  cursor?: Cursor;
  filter?: ListFilter;
  /** Matches the title, the id and the language. Never the body — searching text is a
   *  separate feature with its own privacy question (Appendix A). */
  query?: string;
}

/** Counts and bytes across everything a person owns, not just the current page.
 *
 *  Separate from listPastes because it answers a different question: the filter tabs
 *  and the "N pastes, M stored" line are about the whole collection. Deriving them
 *  from one page made the tabs lie — "Gone 0" while two gone pastes sat on page 3. In
 *  M8 this is a GROUP BY, not a scan. */
export async function pasteSummary(
  _viewer: Viewer,
  username: string,
): Promise<{ all: number; live: number; gone: number; bytes: number }> {
  const mine = PASTES.filter((p) => p.owner === username);
  let live = 0;
  let bytes = 0;
  for (const paste of mine) {
    if (livenessOf(paste).kind === "live") live += 1;
    bytes += paste.byteSize;
  }
  return { all: mine.length, live, gone: mine.length - live, bytes };
}

/** "<createdAt>,<id>" — stable under insertion, unlike an offset. */
function cursorOf(paste: Paste): Cursor {
  return `${paste.createdAt},${paste.id}`;
}

/**
 * One keyset page of a person's pastes, newest first.
 *
 * Ordered by `(createdAt, id)` descending so the tiebreaker is total: two pastes
 * created in the same second would otherwise be able to swap places between requests,
 * which is how a row appears on two pages or is skipped at a boundary.
 */
export async function listPastes(
  _viewer: Viewer,
  username: string,
  options: ListOptions = {},
): Promise<Page<Paste>> {
  const { cursor, filter = "all", query = "" } = options;
  const needle = query.trim().toLowerCase();

  // Filter and search run **before** paging, which is the only order that works: doing
  // it after means a page of 50 rows yields however many survive, the tab counts
  // describe one page rather than the collection, and a filter whose matches all sit
  // on page 3 looks like it has none. M8 moves both into the WHERE clause; the shape
  // of the answer does not change.
  const mine = PASTES.filter((p) => p.owner === username)
    .filter((p) => {
      if (filter === "all") return true;
      const live = livenessOf(p).kind === "live";
      return filter === "live" ? live : !live;
    })
    .filter((p) =>
      needle === ""
        ? true
        : [p.title ?? "", p.id, p.language].some((field) =>
            field.toLowerCase().includes(needle),
          ),
    )
    .toSorted(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );

  // Seek past the cursor rather than counting into the list.
  //
  // A cursor we cannot find is an empty page, never page 1. findIndex returns -1 for
  // "absent", which +1 would turn into 0 — so a stale cursor (its paste purged out of
  // the list between requests) would restart pagination, and a "load more" button would
  // append the same rows forever.
  let start = 0;
  if (cursor !== undefined) {
    const at = mine.findIndex((p) => cursorOf(p) === cursor);
    if (at === -1) return { items: [], next: null, total: mine.length };
    start = at + 1;
  }
  const items = mine.slice(start, start + PAGE_SIZE);
  const last = items.at(-1);

  return {
    items,
    next: last && start + PAGE_SIZE < mine.length ? cursorOf(last) : null,
    total: mine.length,
  };
}
