// @vitest-environment node

// The DOM budget §6.2 is actually about (ARCHITECTURE §6.2, N2, M12).
//
// §6.2 argues that the browser's DOM rather than the server's CPU sets the highlighting
// limit, and the argument is right. The implementation of it was not: the gate was a LINE
// COUNT, and markup per line turns out to be a property of the content rather than of the
// language. `pnpm measure:thresholds` puts the same TypeScript gate at
//
//   174 bytes/line   real code
//   604 bytes/line   lines carrying a generic, a string and a comment
//
// so 2 000 lines is 348 KB or 1.2 MB of HTML depending on who wrote it. The design accepted
// 688 KB. Ordinary code fits with room to spare; dense code breaches it by 1.7× and the
// gate waves it through, because 2 000 ≤ 2 000 whatever the lines contain.
//
// WHAT THIS CATCHES is therefore not a rare case. It is a paste of perfectly ordinary dense
// code shipping megabytes of markup to a phone, which is invisible on a laptop and is
// exactly the failure the threshold exists to prevent. The cap is checked on the markup
// itself, after rendering, by both writers — and a test that only covered one writer would
// leave the backfill as a way back in.

import { describe, expect, it } from "vitest";

import {
  MAX_RENDER_BYTES,
  renderMode,
  renderWorthStoring,
} from "@/lib/render/thresholds";

/** A line dense enough to be expensive, and ordinary enough that someone would write it. */
const DENSE =
  "const value: Record<string, number> = { key: 1 }; // a trailing comment\n";

describe("the markup budget", () => {
  it("accepts a render at the cap and refuses one past it", () => {
    // Bytes, not characters — the body is UTF-8 and a multi-byte paste would otherwise
    // measure short by exactly the amount that matters for a budget.
    expect(renderWorthStoring("a".repeat(MAX_RENDER_BYTES))).toBe(true);
    expect(renderWorthStoring("a".repeat(MAX_RENDER_BYTES + 1))).toBe(false);
    expect(renderWorthStoring("é".repeat(MAX_RENDER_BYTES))).toBe(false);
  });

  it("would have let a dense 2 000-line body through the old gate", async () => {
    const body = DENSE.repeat(2_000);
    const byteSize = new TextEncoder().encode(body).length;

    // THE GATE SAYS YES. Under HIGHLIGHT_BYTES, exactly at HIGHLIGHT_LINES — this body is
    // not an edge case smuggled past a limit, it is the limit's own definition of
    // acceptable.
    expect(renderMode(byteSize, 2_000)).toBe("highlight");

    const { highlight } = await import("@/lib/render/highlight");
    const html = await highlight(body, "typescript");

    // AND THE MARKUP SAYS NO, by a margin no choice of line count could have predicted:
    // the same count of real code renders to under a third of the cap.
    expect(html).not.toBeNull();
    expect(renderWorthStoring(html!)).toBe(false);
  }, 30_000);

  it("keeps the render for an ordinary file of the same language", async () => {
    // Guards the guard. A cap that refused real code would be worse than no cap: every
    // paste would serve unhighlighted text and the §6.2 feature would be silently off.
    const { readFile } = await import("node:fs/promises");
    const body = await readFile("src/lib/server/create-paste.ts", "utf8");

    const { highlight } = await import("@/lib/render/highlight");
    const html = await highlight(body, "typescript");

    expect(html).not.toBeNull();
    expect(renderWorthStoring(html!)).toBe(true);
  }, 30_000);

  it("is checked by every writer of a render, not just the create path", async () => {
    // A backfill storing markup the create path refused would reintroduce the breach by
    // the back door, and silently: nothing on the view page says which writer produced a
    // render. Asserted on the source because the alternative is seeding a megabyte of
    // dense code through two code paths to observe one `continue`.
    const { readFile } = await import("node:fs/promises");

    for (const file of [
      "src/lib/server/create-paste.ts",
      "src/app/api/renders/route.ts",
      // The fixture corpus too, where it THROWS rather than skipping: a fixture is
      // authored, so markup the app would refuse means the designed screen shows
      // highlighting no equivalent paste could get.
      "scripts/render-fixtures.mts",
    ]) {
      const source = await readFile(file, "utf8");
      expect(source, file).toContain("renderWorthStoring(html)");
    }
  });
});
