import { describe, expect, it } from "vitest";

import { listPastes, PAGE_SIZE } from "@/lib/server/paste-service";
import { PASTES } from "@/lib/fixtures";
import type { Viewer } from "@/lib/types";

// The two classic pagination faults, caught while they are still cheap.
//
// Both are invisible in a single-page list and both appear the moment there is real
// volume: a row shown on two consecutive pages, and a row skipped at a page boundary.
// A keyset cursor only avoids them if its sort key is **total** — ordering on
// `createdAt` alone leaves ties, and two pastes created in the same second can swap
// places between two requests, which is exactly when a row slips through the gap.
//
// The fixtures include two filler pastes that deliberately share a `createdAt`, so
// these run against the tie rather than around it.

const VIEWER: Viewer = { kind: "anon" };
const OWNER = "deepika";

async function walk(): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  // A guard rather than `while (true)`: a broken cursor that always returns page one
  // would otherwise hang the suite instead of failing it.
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await listPastes(VIEWER, OWNER, { cursor });
    seen.push(...page.items.map((p) => p.id));
    if (page.next === null) return seen;
    cursor = page.next;
  }
  throw new Error("pagination did not terminate in 50 pages");
}

describe("keyset pagination", () => {
  it("has enough rows and a timestamp tie to be worth testing", () => {
    // Guards the guard: these assertions pass trivially on a single short page.
    const mine = PASTES.filter((p) => p.owner === OWNER);
    expect(mine.length).toBeGreaterThan(PAGE_SIZE);

    const byCreatedAt = new Map<string, number>();
    for (const paste of mine) {
      byCreatedAt.set(
        paste.createdAt,
        (byCreatedAt.get(paste.createdAt) ?? 0) + 1,
      );
    }
    expect([...byCreatedAt.values()].some((n) => n > 1)).toBe(true);
  });

  it("shows every paste exactly once across all pages", async () => {
    const seen = await walk();
    const mine = PASTES.filter((p) => p.owner === OWNER);

    // A duplicate means a row appeared on two consecutive pages.
    expect(new Set(seen).size).toBe(seen.length);
    // A shortfall means a row was skipped at a boundary.
    expect(seen).toHaveLength(mine.length);
    expect(seen.toSorted()).toEqual(mine.map((p) => p.id).toSorted());
  });

  it("orders strictly descending, with the id breaking ties", async () => {
    const seen = await walk();
    const keyOf = (id: string) => {
      const paste = PASTES.find((p) => p.id === id)!;
      return `${paste.createdAt},${paste.id}`;
    };
    const keys = seen.map(keyOf);
    expect(keys).toEqual([...keys].toSorted().reverse());
  });

  it("does not repeat the cursor row on the next page", async () => {
    const first = await listPastes(VIEWER, OWNER);
    expect(first.next).not.toBeNull();
    const second = await listPastes(VIEWER, OWNER, { cursor: first.next! });

    const overlap = second.items.filter((p) =>
      first.items.some((q) => q.id === p.id),
    );
    expect(overlap).toEqual([]);
    // The cursor names the last row of the previous page, so the next page starts
    // after it, not at it.
    expect(second.items[0]?.id).not.toBe(first.items.at(-1)?.id);
  });

  it("reports the owner's total on every page, not the page size", async () => {
    const first = await listPastes(VIEWER, OWNER);
    const second = await listPastes(VIEWER, OWNER, { cursor: first.next! });
    const mine = PASTES.filter((p) => p.owner === OWNER);
    expect(first.total).toBe(mine.length);
    expect(second.total).toBe(mine.length);
  });

  it("fills every page but the last", async () => {
    const first = await listPastes(VIEWER, OWNER);
    expect(first.items).toHaveLength(PAGE_SIZE);
  });
});
