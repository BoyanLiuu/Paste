import { describe, expect, it } from "vitest";

import { DEFAULT_RETENTION } from "@/lib/expiry/retention";
import { formatBytes } from "@/lib/format";
import { MAX_BYTES } from "@/lib/render/thresholds";
import { createPasteSchema, TITLE_MAX } from "@/lib/schema/create-paste";

// One schema validates the form and POST /api/pastes, so these assertions cover both
// callers at once. That is the point of sharing it.

const valid = {
  body: "print('hi')\n",
  retention: DEFAULT_RETENTION,
};

const fieldErrors = (input: unknown) => {
  const result = createPasteSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? {} : result.error.flatten().fieldErrors;
};

describe("createPasteSchema", () => {
  it("accepts a minimal paste and applies the defaults", () => {
    const result = createPasteSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.language).toBe("auto");
    expect(result.data.lineNumbers).toBe(false);
  });

  it("refuses an empty body", () => {
    // Catches a submit that posts nothing because the textarea was never touched.
    expect(fieldErrors({ ...valid, body: "" }).body?.[0]).toMatch(
      /nothing to save/i,
    );
  });

  // "never" is the only retention with unbounded cost. The reason is what keeps it
  // rare without forbidding it, so a missing one has to fail on both paths — the form
  // and the API — which is why the rule is in the schema and not the component.
  it("requires a reason when retention is never", () => {
    expect(
      fieldErrors({ ...valid, retention: "never" }).neverReason?.[0],
    ).toMatch(/say why/i);
  });

  it("refuses whitespace as a never-reason", () => {
    // Catches the trivial way around the rule: a space satisfies a non-empty check.
    expect(
      fieldErrors({ ...valid, retention: "never", neverReason: "   " })
        .neverReason?.[0],
    ).toMatch(/say why/i);
  });

  it("accepts never with a reason", () => {
    const result = createPasteSchema.safeParse({
      ...valid,
      retention: "never",
      neverReason: "Linked from the Q3 design doc.",
    });
    expect(result.success).toBe(true);
  });

  it("does not demand a reason for any other retention", () => {
    for (const retention of ["1h", "1d", "30d", "1y"] as const) {
      expect(createPasteSchema.safeParse({ ...valid, retention }).success).toBe(
        true,
      );
    }
  });

  it("refuses a body over the cap and names its real size", () => {
    const over = "a".repeat(Math.round(MAX_BYTES * 1.1));
    const message = fieldErrors({ ...valid, body: over }).body?.[0] ?? "";

    // BOTH FIGURES DERIVED, neither written down. This asserted `/11\.0 MB/` — the old
    // 10 MB ceiling times 1.1 — and broke the moment the limit moved to 25 MB, reporting
    // a failure against a message that was perfectly correct. The same rot as the
    // hardcoded "11 MB of log" sample label, in the test that was supposed to guard it.
    expect(message).toContain(formatBytes(over.length));
    expect(message).toContain(formatBytes(MAX_BYTES));
    // "Too large" leaves the user guessing how much to cut.
    expect(message).toMatch(/file, not a snippet/);
    // Catches a message that states the size and the limit as the same number: at
    // cap+1KB both round to the same figure and the refusal reads like a bug. An earlier
    // version of this test asserted that broken output.
    const figures = message.match(/[\d.]+ MB/g) ?? [];
    expect(figures).toHaveLength(2);
    expect(figures[0]).not.toBe(figures[1]);
  });

  // Catches the bug a character count would hide: UTF-8 spends up to four bytes on a
  // code point, so a quarter as many emoji as the byte cap are already over it.
  it("measures the cap in bytes, not characters", () => {
    const fourBytesEach = "😀".repeat(Math.ceil(MAX_BYTES / 4) + 1);
    expect(fourBytesEach.length).toBeLessThan(MAX_BYTES);
    expect(fieldErrors({ ...valid, body: fourBytesEach }).body?.[0]).toMatch(
      /file, not a snippet/,
    );
  });

  it("refuses an over-long title", () => {
    expect(
      fieldErrors({ ...valid, title: "x".repeat(TITLE_MAX + 1) }).title?.[0],
    ).toMatch(new RegExp(String(TITLE_MAX)));
  });

  it("refuses a retention code it does not offer", () => {
    expect(
      fieldErrors({ ...valid, retention: "10y" }).retention?.[0],
    ).toBeDefined();
  });
});
