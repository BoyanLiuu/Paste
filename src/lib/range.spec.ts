import { describe, expect, it } from "vitest";

import { formatRange, parseRange } from "@/lib/range";

// The fragment is user-editable text in the address bar, so every malformed form has
// to produce null or a usable range — never a throw and never a blank page. Someone
// truncating a pasted URL is the common case, not an attack.

const LINES = 40;

describe("parseRange", () => {
  it("reads a single line", () => {
    expect(parseRange("#L10", LINES)).toEqual({ start: 10, end: 10 });
  });

  it("reads a range", () => {
    expect(parseRange("#L10-L20", LINES)).toEqual({ start: 10, end: 20 });
  });

  it("accepts the hyphen form without the second L", () => {
    // Hand-typed and produced by some editors; refusing it would be pedantry.
    expect(parseRange("#L10-20", LINES)).toEqual({ start: 10, end: 20 });
  });

  it("orders a reversed range instead of refusing it", () => {
    // The user dragged upwards, or swapped the ends by hand. Both mean the same span.
    expect(parseRange("#L20-L10", LINES)).toEqual({ start: 10, end: 20 });
  });

  it("works without the leading hash", () => {
    expect(parseRange("L3", LINES)).toEqual({ start: 3, end: 3 });
  });

  it.each([
    ["#L0", "line numbering starts at 1, so a zero is a truncated fragment"],
    ["#L0-L5", "same, in a range"],
    [
      `#L${LINES + 1}`,
      "past the end: clamping would answer a different question",
    ],
    [`#L5-L${LINES + 1}`, "same, as the far end of a range"],
    ["#L", "no number at all"],
    ["#Lfoo", "not a number"],
    ["#section-heading", "an ordinary fragment on the page"],
    ["", "no fragment"],
    ["#L1.5", "fractional"],
    ["#L-5", "negative"],
  ])("refuses %s — %s", (fragment) => {
    expect(parseRange(fragment, LINES)).toBeNull();
  });

  it("does not throw on anything the address bar can hold", () => {
    for (const junk of [
      "#L".repeat(500),
      "#L999999999999999999999",
      "#L1-L2-L3",
    ]) {
      expect(() => parseRange(junk, LINES)).not.toThrow();
    }
  });
});

describe("formatRange", () => {
  it("writes a single line as #L12, not #L12-L12", () => {
    // The URL someone pastes into a ticket should be the shortest thing that means
    // what they selected.
    expect(formatRange({ start: 12, end: 12 })).toBe("#L12");
  });

  it("writes a span as #L10-L20", () => {
    expect(formatRange({ start: 10, end: 20 })).toBe("#L10-L20");
  });

  it("round-trips every parseable range", () => {
    for (const range of [
      { start: 1, end: 1 },
      { start: 1, end: 40 },
      { start: 7, end: 9 },
    ]) {
      expect(parseRange(formatRange(range), LINES)).toEqual(range);
    }
  });
});
