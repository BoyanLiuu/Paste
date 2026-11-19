// The only path any screen uses to reach data (ARCHITECTURE Appendix C).
//
// M8 replaced every body here with a Prisma query. THE SIGNATURES DID NOT CHANGE, which
// is the whole return on Appendix C: this milestone touched no JSX. Every function was
// already `async` and every owner-scopable one already took the viewer first, so the
// components built in M3 and M4 against fixtures now read real rows without moving.
//
// Server-only. Importing this from a client component should fail loudly rather than
// bundle the data layer into the browser.

import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { liveWhere } from "@/lib/server/live-where";
import { renderMode, TRUNCATE_LINES } from "@/lib/render/thresholds";
import { getBody, storageConfigured } from "@/lib/storage/body";
import { DEFAULT_THEME } from "@/lib/render/keys";
import { PASTE_INCLUDE, toPaste } from "@/lib/server/map";
import { prisma } from "@/lib/server/prisma";
import type { Cursor, Page, Paste, Viewer } from "@/lib/types";

/** Rows per page on /list/:username. Keyset, so this is a slice size, not an offset. */
export const PAGE_SIZE = 50;

/**
 * One paste by id, or null when no paste has ever had that id.
 *
 * Returns the row whatever its state. **Callers must not treat a returned paste as
 * readable**: expiry is recomputed on the read path (§6.3), so the page decides between
 * content, a 410 tombstone and a 404. Putting that decision here would hide it — and
 * would make a 404 and a 410 indistinguishable to the one caller that must tell them
 * apart.
 */
/**
 * One paste by id, or null when no paste has ever had that id.
 *
 * Deliberately NOT wrapped in React's `cache()`. That was the first attempt at the
 * duplicate read below, and measurement on the real server showed it deduplicated
 * nothing: `generateMetadata` resolves in a different pass from the component tree under
 * `cacheComponents`, so the second call misses however it is keyed. A wrapper that
 * implies a saving it does not deliver is worse than none — the fix is `getPasteMeta`,
 * which simply stops asking for an expensive row.
 */
export async function getPaste(
  _viewer: Viewer,
  id: string,
): Promise<Paste | null> {
  const row = await prisma.paste.findUnique({
    where: { id },
    include: PASTE_INCLUDE,
  });

  if (row === null) return null;
  return withStoredBody(toPaste(row), row.revisions.at(-1)?.storageKey ?? null);
}

/**
 * Fill in `body` for a revision whose bytes live in an object (§6.2, §6.4).
 *
 * The mapper cannot do this: it is synchronous, and fetching an object is not. So the
 * domain object comes back with `body: null` for an object-stored revision and this adds
 * the text — truncated for display, because the alternative is shipping 20 MB through a
 * React render to show someone the first screenful.
 *
 * A null body is still a legitimate outcome: the object is gone after a purge, and the
 * read paths already answer that with a tombstone. A missing object on a live paste reads
 * the same way, which is the cost of the create path writing the object first (see
 * `create-paste.ts`) — an orphan is wasted bytes, a dangling pointer is a visible lie,
 * and this is the direction that keeps the lie impossible.
 */
async function withStoredBody(
  paste: Paste,
  storageKey: string | null,
): Promise<Paste> {
  if (storageKey === null || !storageConfigured()) return paste;

  // Deliberately not caught. `getBody` throws when the object cannot be read, and the
  // request failing is the correct outcome: a live revision's object must exist, so a
  // missing one is an anomaly. Swallowing it renders an empty `<pre>` and tells the
  // reader the snippet is empty.
  const body = await getBody(storageKey);

  // The §6.2 ladder: above 2 MB a reader gets the first 500 lines and a banner naming the
  // real total. `lineCount` and `byteSize` keep describing the whole thing, which is what
  // the banner reads.
  if (renderMode(paste.byteSize, paste.lineCount) === "truncated") {
    const shown = body.split("\n").slice(0, TRUNCATE_LINES);
    return {
      ...paste,
      body: `${shown.join("\n")}\n`,
      bodyShown: shown.length,
    };
  }

  return { ...paste, body, bodyShown: paste.lineCount };
}

/**
 * The stored HTML for a revision, or null when none was rendered.
 *
 * A null is a legitimate answer, not an error: bodies above the §6.2 threshold never get
 * a render, and a purge deletes one. The view page falls back to escaped plain text,
 * which is also what keeps the stored render safe to delete.
 *
 * **This never renders.** N2 is "0 highlighter invocations on the read path", and a lazy
 * `if (missing) highlight()` here is the single change that would break it — the module
 * is reachable from the view route, so `view-route-imports.spec.ts` fails the build if
 * Shiki ever enters this graph. Backfilling missing renders is
 * `src/app/api/renders/route.ts`, driven by cron.
 */
export async function getRender(
  revisionId: string,
  theme = DEFAULT_THEME,
): Promise<string | null> {
  // Keyed on (revision_id, theme), not on the revision alone: a theme or Shiki upgrade
  // adds a row rather than mutating one, so two generations of markup never coexist
  // under one key.
  const row = await prisma.render.findUnique({
    where: { revisionId_theme: { revisionId, theme } },
    select: { html: true },
  });

  return row?.html ?? null;
}

export interface PasteMeta {
  id: string;
  title: string | null;
  language: string;
  lineCount: number;
}

/**
 * Just what `generateMetadata` needs: a title, a language, a line count.
 *
 * A separate, narrow query rather than `getPaste`. Measured on the real server, one view
 * of `/p/:id` issued TWO full paste reads — the page's and the metadata's — each dragging
 * in the owner join and every revision. React's `cache()` does not bridge the two:
 * `generateMetadata` resolves in a different pass from the component tree under
 * `cacheComponents`, so the second call is a miss however it is keyed.
 *
 * Rather than fight that, metadata stops asking for something expensive. Four columns and
 * one revision, which is all a `<title>` and a description can use anyway.
 *
 * Takes the viewer first and ignores it, like `getPaste`. Appendix C's rule is that every
 * owner-scopable read already has the argument, so M10 fills in visibility without
 * touching a call site — and `service-contract.spec.ts` enforces it rather than trusting
 * that a new function remembered.
 */
export async function getPasteMeta(
  _viewer: Viewer,
  id: string,
): Promise<PasteMeta | null> {
  const row = await prisma.paste.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      language: true,
      revisions: {
        orderBy: { revisionNo: "desc" },
        take: 1,
        select: { lineCount: true },
      },
    },
  });

  if (row === null) return null;

  return {
    id: row.id,
    title: row.title,
    language: row.language,
    lineCount: row.revisions[0]?.lineCount ?? 0,
  };
}

/**
 * The stored HTML for a paste's head revision, or null.
 *
 * The view page's actual question. `getRender` takes a revision uuid, and the domain
 * `Revision` type deliberately does not carry one — the fixtures have no uuids and
 * `seam.spec.ts` asserts the two shapes match key-for-key, so adding `id` to the domain
 * type to let the page do this lookup would push a database detail into every screen.
 * One query resolves the head and its render together instead.
 */
export async function getRenderForPaste(
  _viewer: Viewer,
  pasteId: string,
  theme = DEFAULT_THEME,
): Promise<string | null> {
  const row = await prisma.revision.findFirst({
    where: { pasteId },
    orderBy: { revisionNo: "desc" },
    select: {
      renders: { where: { theme }, select: { html: true } },
    },
  });

  return row?.renders[0]?.html ?? null;
}

/**
 * Pastes forked from this one, for the view page's provenance panel.
 *
 * Covered by the `pastes_forked_from` partial index, so this stays cheap for the vast
 * majority of pastes that have no forks at all.
 */
export async function getForks(
  _viewer: Viewer,
  pasteId: string,
): Promise<Paste[]> {
  const rows = await prisma.paste.findMany({
    where: { forkedFrom: pasteId },
    include: PASTE_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // A provenance panel, not a list page. A paste with 400 forks shows the recent ones
    // rather than making the hot path pay for all of them.
    take: 20,
  });

  return rows.map(toPaste);
}

/**
 * The raw body, as the raw origin and the copy button read it.
 *
 * Reads the head revision's bytes. Null once purged, and null for a body in object
 * storage until M9 streams it — both of which the raw route already answers.
 */
export async function getRaw(
  _viewer: Viewer,
  id: string,
): Promise<string | null> {
  const row = await prisma.revision.findFirst({
    where: { pasteId: id },
    orderBy: { revisionNo: "desc" },
    select: { bodyText: true, storageKey: true },
  });

  if (row === null) return null;
  // The WHOLE body, never truncated. This is what `/raw` and `/dl` serve and what the copy
  // button fetches, so a reader piping it into a file must get every byte — the 500-line
  // display limit is a rendering decision and has no business here.
  if (row.storageKey !== null) {
    // Throws if the object cannot be read, for the same reason as above: /raw serving an
    // empty file is a worse answer than /raw returning an error.
    return storageConfigured() ? await getBody(row.storageKey) : null;
  }

  return row.bodyText;
}

export type ListFilter = "all" | "live" | "gone";

export interface ListOptions {
  cursor?: Cursor;
  filter?: ListFilter;
  /** Matches the title, the id and the language. Never the body — searching text is a
   *  separate feature with its own privacy question (Appendix A). */
  query?: string;
}

/**
 * Counts and bytes across everything a person owns, not just the current page.
 *
 * Separate from listPastes because it answers a different question: the filter tabs and
 * the "N pastes, M stored" line are about the whole collection. Deriving them from one
 * page made the tabs lie — "Gone 0" while two gone pastes sat on page 3.
 *
 * Two queries rather than one GROUP BY, and deliberately so. "Live" is not a column: it
 * is `expires_at > now()` recomputed per request (§6.3), so grouping by `state` would
 * report whatever the sweeper last wrote. The counts have to use the same predicate the
 * read path uses or the tabs disagree with the pages they open.
 */
export async function pasteSummary(
  _viewer: Viewer,
  username: string,
): Promise<{ all: number; live: number; gone: number; bytes: number }> {
  const now = new Date();

  const [all, live, bytes] = await Promise.all([
    prisma.paste.count({ where: { owner: { username } } }),
    prisma.paste.count({
      where: { owner: { username }, ...liveWhere(now) },
    }),
    // Bytes across the head revision of every paste, gone or not: the figure is "how
    // much of your quota this account is using", and an expired-but-unpurged paste is
    // still occupying rows.
    prisma.revision.aggregate({
      where: { paste: { owner: { username } }, purgedAt: null },
      _sum: { byteSize: true },
    }),
  ]);

  return {
    all,
    live,
    gone: all - live,
    bytes: bytes._sum.byteSize ?? 0,
  };
}

/** "<createdAt>,<id>" — stable under insertion, unlike an offset. */
function cursorOf(paste: { createdAt: string; id: string }): Cursor {
  return `${paste.createdAt},${paste.id}`;
}

/** Split a cursor back into its two halves, or null if it is not one we issued. */
function parseCursor(cursor: Cursor): { createdAt: Date; id: string } | null {
  const comma = cursor.lastIndexOf(",");
  if (comma === -1) return null;

  const createdAt = new Date(cursor.slice(0, comma));
  const id = cursor.slice(comma + 1);
  if (Number.isNaN(createdAt.getTime()) || id === "") return null;

  return { createdAt, id };
}

/**
 * One keyset page of a person's pastes, newest first.
 *
 * Ordered by `(createdAt, id)` descending so the tiebreaker is total: two pastes created
 * in the same millisecond would otherwise be able to swap places between requests, which
 * is how a row appears on two pages or is skipped at a boundary.
 *
 * The seek is a real row comparison — `(created_at, id) < (cursor_created_at, cursor_id)`
 * — not an OFFSET. An offset re-counts from the start on every page and shifts under
 * insertion, so a paste created while someone pages through appears twice.
 */
export async function listPastes(
  _viewer: Viewer,
  username: string,
  options: ListOptions = {},
): Promise<Page<Paste>> {
  const { cursor, filter = "all", query = "" } = options;
  const needle = query.trim();
  const now = new Date();

  // EVERY CONDITION GOES IN `AND`, never spread as sibling keys.
  //
  // The first version built this object with spreads, and three of the conditions below
  // contribute an `OR`. In an object literal the last `OR` wins, so the conditions
  // silently cancelled each other: `filter: "live"` plus a search dropped the expiry
  // check and listed expired pastes, and paging a searched list dropped the search and
  // returned non-matching rows on page two. Both type-check, both look right, and neither
  // is visible until a filter and a search are used together — which no test did.
  //
  // `AND` composes. Prisma gives no warning for a duplicated key, so the only defence is
  // never to write the shape that can collide.
  const conditions: Prisma.PasteWhereInput[] = [{ owner: { username } }];

  if (filter === "live") conditions.push(liveWhere(now));
  if (filter === "gone") conditions.push({ NOT: liveWhere(now) });

  // Filter and search run in the WHERE, not after paging. Doing them after means a page
  // of 50 yields however many survive, and a filter whose matches all sit on page 3 looks
  // like it has none.
  if (needle !== "") {
    conditions.push({
      OR: [
        { title: { contains: needle, mode: "insensitive" } },
        { id: { contains: needle, mode: "insensitive" } },
        { language: { contains: needle, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.PasteWhereInput = { AND: conditions };

  const seek = cursor === undefined ? null : parseCursor(cursor);
  if (cursor !== undefined && seek === null) {
    // A cursor we cannot parse is an empty page, never page 1. Restarting pagination
    // would make a "load more" button append the same rows forever.
    return { items: [], next: null, total: 0 };
  }

  // The seek is one more condition, appended rather than merged — for the same reason.
  const paged: Prisma.PasteWhereInput = {
    AND:
      seek === null
        ? conditions
        : [
            ...conditions,
            {
              // The keyset comparison, spelled out because Prisma has no row-value
              // operator: strictly older, or the same instant with a smaller id.
              OR: [
                { createdAt: { lt: seek.createdAt } },
                { createdAt: seek.createdAt, id: { lt: seek.id } },
              ],
            },
          ],
  };

  const [rows, total] = await Promise.all([
    prisma.paste.findMany({
      where: paged,
      include: PASTE_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // One more than the page, so "is there a next page" is answered without a second
      // count query and without guessing from a full page.
      take: PAGE_SIZE + 1,
    }),
    prisma.paste.count({ where }),
  ]);

  const items = rows.slice(0, PAGE_SIZE).map(toPaste);
  const hasMore = rows.length > PAGE_SIZE;
  const last = items.at(-1);

  return {
    items,
    next: hasMore && last !== undefined ? cursorOf(last) : null,
    total,
  };
}
