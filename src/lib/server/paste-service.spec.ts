import { describe, expect, it } from "vitest";

import { getRender, listPastes, PAGE_SIZE } from "@/lib/server/paste-service";
import { renderKey, revisionKey } from "@/lib/render/keys";
import { RENDERS } from "@/lib/fixtures/renders.generated";
import type { Viewer } from "@/lib/types";

const VIEWER: Viewer = { kind: "anon" };

describe("listPastes", () => {
  it("returns an empty page for a cursor it cannot find", async () => {
    // Catches the bug where findIndex's -1 becomes start 0: a stale cursor — its paste
    // purged out of the list between requests — silently restarts pagination, so a
    // "load more" button appends the same rows forever.
    const first = await listPastes(VIEWER, "deepika");
    const stale = await listPastes(
      VIEWER,
      "deepika",
      "2020-01-01T00:00:00Z,GONE",
    );

    expect(first.items.length).toBeGreaterThan(0);
    expect(stale.items).toEqual([]);
    expect(stale.next).toBeNull();
    expect(stale.total).toBe(first.total);
  });

  it("walks every paste exactly once across pages", async () => {
    // Catches a row appearing on two consecutive pages or being skipped at a boundary,
    // which is what an unstable sort key would cause.
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const page = await listPastes(VIEWER, "deepika", cursor);
      seen.push(...page.items.map((p) => p.id));
      if (page.next === null) break;
      cursor = page.next;
    }
    const first = await listPastes(VIEWER, "deepika");
    expect(seen).toHaveLength(first.total);
    expect(new Set(seen).size).toBe(first.total);
  });

  it("reports the owner's total, not the page size", async () => {
    const page = await listPastes(VIEWER, "deepika");
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(PAGE_SIZE);
  });

  it("gives a stranger an empty page rather than everyone's pastes", async () => {
    const page = await listPastes(VIEWER, "nobody-by-this-name");
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });
});

describe("getRender", () => {
  it("keys on the theme as well as the revision", async () => {
    // Catches the seam drift: phase 2 keys paste_renders on (revision_id, theme), so a
    // lookup ignoring the theme would return the wrong markup once a second one exists.
    const id = revisionKey("7fK2mQxZ", 1);
    expect(Object.keys(RENDERS)).toContain(renderKey(id));
    await expect(getRender(id)).resolves.toBeTypeOf("string");
    await expect(getRender(id, "a-theme-nobody-rendered")).resolves.toBeNull();
  });

  it("returns null for a body above the highlight threshold", async () => {
    await expect(getRender(revisionKey("Kp2sM7aJ", 1))).resolves.toBeNull();
  });
});
