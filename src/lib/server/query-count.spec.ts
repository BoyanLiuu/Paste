// @vitest-environment node

// Keeps the view route's metadata off the expensive query.
//
// Measured on the real server with Prisma query logging on, one view of `/p/:id` issued
// TWO full paste reads — the page component's and `generateMetadata`'s — each dragging in
// the owner join and every revision. React's `cache()` was the obvious fix and does not
// work here: metadata resolves in a different pass from the component tree under
// `cacheComponents`, so the second call misses however it is keyed. Measuring is what
// showed that; the wrapper looked like it was earning something.
//
// So metadata asks a narrower question instead, and this is what stops someone quietly
// pointing it back at `getPaste` — which type-checks, renders identically, and doubles
// the cost of the hot path with no visible symptom.

import { describe, expect, it } from "vitest";

import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { getPaste, getPasteMeta } from "@/lib/server/paste-service";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

const VIEWER: Viewer = { kind: "anon" };
const reason = skipReason();

/** The arguments every `paste.findUnique` was called with while `body` ran. */
async function recordFinds<T>(
  body: () => Promise<T>,
): Promise<{ result: T; calls: Record<string, unknown>[] }> {
  const calls: Record<string, unknown>[] = [];

  // Wraps rather than replaces, so the query still runs and these assertions are about a
  // real read rather than about a stub that agreed with them.
  const original = prisma.paste.findUnique.bind(prisma.paste);
  const wrapper = ((args: Record<string, unknown>) => {
    calls.push(args);
    return (original as (a: unknown) => unknown)(args);
  }) as typeof prisma.paste.findUnique;

  (prisma.paste as unknown as Record<string, unknown>).findUnique = wrapper;
  try {
    return { result: await body(), calls };
  } finally {
    (prisma.paste as unknown as Record<string, unknown>).findUnique =
      original as unknown;
  }
}

describe.skipIf(reason !== null)(
  `the view route's metadata query${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("selects four columns rather than including every relation", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [
          { title: "notes", language: "yaml" },
        ]);

        const { result, calls } = await recordFinds(() =>
          getPasteMeta(VIEWER, id),
        );

        expect(result).toEqual({
          id,
          title: "notes",
          language: "yaml",
          lineCount: 1,
        });

        expect(calls).toHaveLength(1);
        // `select`, never `include`. `include: PASTE_INCLUDE` pulls the owner join and
        // every revision with its author — the page needs that and a `<title>` does not.
        expect(calls[0].select).toBeDefined();
        expect(calls[0].include).toBeUndefined();
      });
    });

    it("is cheaper than the page's read, which does need the relations", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{}]);

        // Guards the comparison rather than asserting a number: the point is that the two
        // reads are deliberately different shapes, and that the page's is the heavy one.
        const page = await recordFinds(() => getPaste(owner.viewer, id));
        expect(page.calls[0].include).toBeDefined();

        const meta = await recordFinds(() => getPasteMeta(VIEWER, id));
        expect(meta.calls[0].include).toBeUndefined();
      });
    });

    it("returns null for an id no paste has ever had", async () => {
      // `generateMetadata` renders "Not found — Paste" from this, so it must not throw on
      // the 404 path the proxy has already decided.
      await expect(getPasteMeta(VIEWER, "zzzzzzzz")).resolves.toBeNull();
    });
  },
);
