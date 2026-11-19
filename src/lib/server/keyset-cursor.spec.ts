// @vitest-environment node

// The two classic pagination faults, now against real rows.
//
// Both are invisible in a single-page list and both appear the moment there is volume: a
// row shown on two consecutive pages, and a row skipped at a page boundary. A keyset
// cursor only avoids them if its sort key is TOTAL — ordering on `createdAt` alone leaves
// ties, and two pastes created in the same millisecond can swap places between requests,
// which is exactly when a row slips through the gap.
//
// Rewritten at M8. It used to page over fixtures, which made it a test of an in-memory
// sort; the implementation is now `(created_at, id) <` in SQL, so the test has to exercise
// the database or it is testing nothing that ships. Several rows deliberately share a
// `createdAt` so the tie is hit rather than avoided.

import { describe, expect, it } from "vitest";

import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { listPastes, PAGE_SIZE } from "@/lib/server/paste-service";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

const VIEWER: Viewer = { kind: "anon" };
const reason = skipReason();

/** Enough to need three pages, with a block of exact timestamp ties in the middle. */
function seeds(): { minutesAgo: number }[] {
  const out: { minutesAgo: number }[] = [];
  for (let i = 0; i < PAGE_SIZE * 2 + 7; i += 1) {
    // Rows 20–26 all share one timestamp, which straddles the first page boundary at 50
    // once the list is ordered newest-first.
    out.push({ minutesAgo: i >= 20 && i <= 26 ? 20 : i });
  }
  return out;
}

async function walk(username: string): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  // A guard rather than `while (true)`: a broken cursor that always returns page one
  // would otherwise hang the suite instead of failing it.
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await listPastes(VIEWER, username, { cursor });
    seen.push(...page.items.map((p) => p.id));
    if (page.next === null) return seen;
    cursor = page.next;
  }
  throw new Error("pagination did not terminate in 50 pages");
}

describe.skipIf(reason !== null)(
  `keyset pagination${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("shows every paste exactly once across all pages", async () => {
      await withTestOwner(async (owner) => {
        const ids = await seedPastes(owner.userId, seeds());

        const seen = await walk(owner.username);

        // The two faults, stated directly. A duplicate means the cursor did not advance
        // past a tie; a missing row means it advanced too far.
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen.toSorted()).toEqual(ids.toSorted());
      });
    });

    it("pages in exactly the order the database itself returns", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, seeds());

        // The database is the oracle, not a JavaScript comparison.
        //
        // The first version asserted `previous.id > current.id` for tied timestamps and
        // failed on `RBDNRoWJ` before `gZVjckbw`: Postgres orders text by the database
        // collation, which is case-insensitive at the primary level, so `R` sorts before
        // `g`. JavaScript's `>` compares UTF-16 code units, where `R` (0x52) is less than
        // `g` (0x67). The ordering was correct and the assertion was wrong — the same
        // collation trap `rls.spec.ts` only avoids by luck.
        //
        // What actually matters is that paging reproduces the total order, so the
        // comparison is left to the thing that defines it.
        const ordered = await prisma.paste.findMany({
          where: { owner: { username: owner.username } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });

        expect(await walk(owner.username)).toEqual(ordered.map((p) => p.id));
      });
    });

    it("never goes back in time across a page boundary", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, seeds());

        let cursor: string | undefined;
        const timestamps: string[] = [];
        for (let guard = 0; guard < 50; guard += 1) {
          const page = await listPastes(VIEWER, owner.username, { cursor });
          timestamps.push(...page.items.map((p) => p.createdAt));
          if (page.next === null) break;
          cursor = page.next;
        }

        // Timestamps are safe to compare in JavaScript — ISO strings sort identically
        // either way. Non-increasing rather than strictly decreasing, because the seed
        // deliberately includes a block of exact ties straddling the page boundary.
        for (let i = 1; i < timestamps.length; i += 1) {
          expect(
            timestamps[i] <= timestamps[i - 1],
            `${timestamps[i - 1]} then ${timestamps[i]}`,
          ).toBe(true);
        }
      });
    });

    it("does not repeat the cursor row on the next page", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, seeds());

        const first = await listPastes(VIEWER, owner.username);
        expect(first.next).not.toBeNull();
        const second = await listPastes(VIEWER, owner.username, {
          cursor: first.next!,
        });

        const overlap = second.items.filter((p) =>
          first.items.some((q) => q.id === p.id),
        );
        // The off-by-one a `<=` seek produces: the cursor row itself reappears as the
        // first item of the next page.
        expect(overlap).toEqual([]);
      });
    });

    it("reports the owner's total on every page, not the page size", async () => {
      await withTestOwner(async (owner) => {
        const ids = await seedPastes(owner.userId, seeds());

        const first = await listPastes(VIEWER, owner.username);
        const second = await listPastes(VIEWER, owner.username, {
          cursor: first.next!,
        });

        // The "N pastes" line is about the collection. Deriving it from a page made it
        // read "50 pastes" forever.
        expect(first.total).toBe(ids.length);
        expect(second.total).toBe(ids.length);
      });
    });

    it("fills every page but the last", async () => {
      await withTestOwner(async (owner) => {
        const ids = await seedPastes(owner.userId, seeds());

        const pages: number[] = [];
        let cursor: string | undefined;
        for (let guard = 0; guard < 50; guard += 1) {
          const page = await listPastes(VIEWER, owner.username, { cursor });
          pages.push(page.items.length);
          if (page.next === null) break;
          cursor = page.next;
        }

        // A short page in the middle means the filter ran after paging — the bug that
        // made a tab with matches on page 3 look empty.
        for (const size of pages.slice(0, -1)) expect(size).toBe(PAGE_SIZE);
        expect(pages.at(-1)).toBe(ids.length % PAGE_SIZE);
        expect(pages.reduce((a, b) => a + b, 0)).toBe(ids.length);
      });
    });

    it("returns an empty page for a cursor it did not issue", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, seeds());

        // Not page one. `findIndex`-based seeking returned -1 for an unknown cursor,
        // which +1 turned into 0 — so a stale cursor restarted pagination and a "load
        // more" button appended the same rows forever.
        const page = await listPastes(VIEWER, owner.username, {
          cursor: "not-a-cursor",
        });
        expect(page.items).toEqual([]);
        expect(page.next).toBeNull();
      });
    });

    it("pages a filtered list without short pages", async () => {
      await withTestOwner(async (owner) => {
        // Half expired, interleaved, so the filter cannot be satisfied by a contiguous
        // block at either end.
        const total = PAGE_SIZE * 2 + 10;
        await seedPastes(
          owner.userId,
          Array.from({ length: total }, (_, i) => ({
            minutesAgo: i,
            expiresInMinutes: i % 2 === 0 ? 60 : -60,
          })),
        );

        const live = await listPastes(VIEWER, owner.username, {
          filter: "live",
        });
        expect(live.items).toHaveLength(PAGE_SIZE);
        // The filter is in the WHERE, so the total describes the filtered collection.
        expect(live.total).toBe(Math.ceil(total / 2));
        for (const paste of live.items) {
          expect(paste.expiresAt).not.toBeNull();
          expect(Date.parse(paste.expiresAt!)).toBeGreaterThan(Date.now());
        }
      });
    });
  },
);
