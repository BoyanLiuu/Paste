import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";

import { AppShell } from "@/components/app-shell";
import { PasteRow } from "@/components/paste-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes, formatCount } from "@/lib/format";
import { listPastes, pasteSummary } from "@/lib/server/paste-service";
import { getViewer } from "@/lib/server/session";
import type { Viewer } from "@/lib/types";

// GET /list/:username (ux-28 – ux-33).
//
// The cursor lives in the URL as ?before=<createdAt>,<id>, which is the same shape M8
// will serve from a real keyset query. Keeping it there now means pagination is a
// link rather than client state, so it survives a reload, a shared URL and the Back
// button for free — and M8 changes the service, not this page.
//
// Request-dependent twice over, like the view page: the cursor and the filters come
// from the query, and livenessOf reads the clock. Hence the Suspense boundary and
// `await connection()`.

type Filter = "all" | "live" | "gone";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ before?: string; filter?: string; q?: string }>;
}) {
  // `params` is awaited inside the boundary, not here: reading it in the outer
  // component makes the whole page request-dependent and prerendering fails under
  // `cacheComponents`. The shell needs nothing from it.
  return (
    <AppShell current="pastes">
      <Suspense fallback={<Loading />}>
        <Listing params={params} searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function Listing({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ before?: string; filter?: string; q?: string }>;
}) {
  await connection();

  // Resolved HERE rather than in the page body, which is what `cacheComponents` requires:
  // `getViewer()` calls Clerk's `auth()`, a request read, and a request read outside a
  // Suspense boundary fails the production build. This component is already inside one.
  const viewer = await getViewer();

  const { username } = await params;
  const { before, filter: rawFilter, q } = await searchParams;
  const filter: Filter =
    rawFilter === "live" || rawFilter === "gone" ? rawFilter : "all";
  const query = (q ?? "").trim().toLowerCase();

  // Both reads go through the service: the filter is applied before paging, and the
  // counts describe the whole collection rather than the page in front of you.
  const [page, counts] = await Promise.all([
    listPastes(viewer, username, { cursor: before, filter, query }),
    pasteSummary(viewer, username),
  ]);

  const rows = page.items;
  const own = viewer.kind === "user" && viewer.user.username === username;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl">
            {own ? "My pastes" : `${username}’s pastes`}
          </h1>
          <p className="text-muted-foreground text-sm">
            {formatCount(counts.all)} {counts.all === 1 ? "paste" : "pastes"},{" "}
            {formatBytes(counts.bytes)} stored
          </p>
        </div>
        <Button asChild>
          <Link href="/new">New paste</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <nav className="flex gap-1">
          {(["all", "live", "gone"] as const).map((key) => (
            <Link
              key={key}
              href={href(username, { filter: key, q })}
              aria-current={filter === key ? "page" : undefined}
              className={
                filter === key
                  ? "border-rule bg-card flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm capitalize"
                  : "text-muted-foreground hover:text-ink flex items-center gap-2 rounded-md px-3 py-1.5 text-sm capitalize transition-colors"
              }
            >
              {key}
              <span className="num text-muted-foreground text-xs">
                {counts[key]}
              </span>
            </Link>
          ))}
        </nav>

        {/* A GET form, so a search is a URL. No JavaScript, and the result is
            shareable and reloadable — which matters more here than instant feedback. */}
        <form method="GET" className="flex gap-2">
          {/* Omitted on "all" so the form produces the same URL href() would write.
              A hidden filter=all made a submitted search ?filter=all&q=… while a
              clicked one was ?q=… — two URLs for one state. */}
          {filter === "all" ? null : (
            <input type="hidden" name="filter" value={filter} />
          )}
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Title, id or language"
            aria-label="Search these pastes"
            className="w-64"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty total={counts.all} query={query} filter={filter} own={own} />
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="border-rule text-muted-foreground border-b text-left">
            <tr>
              <th className="pr-4 pb-2 font-normal">Paste</th>
              <th className="pr-4 pb-2 font-normal">Language</th>
              <th className="pr-4 pb-2 text-right font-normal">Lines</th>
              <th className="pr-4 pb-2 text-right font-normal">Stored</th>
              <th className="pr-4 pb-2 font-normal">Created</th>
              <th className="pr-4 pb-2 font-normal">Expires</th>
              <th className="pb-2 text-right font-normal">Views</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-rule [&>tr]:border-b">
            {rows.map((paste) => (
              <PasteRow key={paste.id} paste={paste} />
            ))}
          </tbody>
        </table>
      )}

      {page.next !== null ? (
        <div className="flex justify-end">
          <Button asChild variant="outline">
            <Link href={href(username, { before: page.next, filter, q })}>
              Show older pastes
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function href(
  username: string,
  params: { before?: string; filter?: Filter; q?: string },
): string {
  const search = new URLSearchParams();
  if (params.before !== undefined) search.set("before", params.before);
  if (params.filter !== undefined && params.filter !== "all") {
    search.set("filter", params.filter);
  }
  if (params.q !== undefined && params.q !== "") search.set("q", params.q);
  const qs = search.toString();
  return `/list/${username}${qs === "" ? "" : `?${qs}`}`;
}

function Empty({
  total,
  query,
  filter,
  own,
}: {
  total: number;
  query: string;
  filter: Filter;
  own: boolean;
}) {
  // Three different empties, because they call for three different things (ux-30,
  // ux-32). "No results" on a brand-new account is a dead end; an invitation is not.
  if (total === 0) {
    return (
      <div className="border-rule flex flex-col items-start gap-3 rounded-lg border px-6 py-10">
        <h2 className="text-lg">{own ? "Nothing here yet" : "No pastes"}</h2>
        <p className="text-ink-2">
          {own
            ? "Paste something and the link will keep answering for as long as you choose."
            : "Nobody has saved anything under that name."}
        </p>
        {own ? (
          <Button asChild>
            <Link href="/new">New paste</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border-rule flex flex-col items-start gap-2 rounded-lg border px-6 py-10">
      <h2 className="text-lg">Nothing matches</h2>
      <p className="text-ink-2">
        {query === "" ? (
          <>
            {/* Not "on this page": filtering runs before pagination, so this
                describes the whole collection. */}
            None of these pastes are <Badge variant="secondary">{filter}</Badge>
            .
          </>
        ) : (
          <>
            Nothing on this page matches “{query}”. Search covers the title, the
            id and the language — not the text, which is deliberate.
          </>
        )}
      </p>
    </div>
  );
}

function Loading() {
  // ux-29.
  return (
    <div
      role="status"
      className="flex flex-col gap-3"
      aria-label="Loading pastes"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="border-rule h-12 animate-pulse rounded-md border"
        />
      ))}
    </div>
  );
}
