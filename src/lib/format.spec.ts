import { describe, expect, it } from "vitest";

import { expiresAt, purgeAfter, RETENTION_CODES } from "@/lib/expiry/retention";
import { formatBytes, formatCount, formatDate, formatTime } from "@/lib/format";

// A paste's expiry is a fact other documents cite, so the date has to read the same to
// everyone. The bug this class of code has is invisible on a machine sharing the
// server's zone, which is why `pnpm test:tz` re-runs the suite under UTC+14.

const NOW = Date.parse("2026-11-12T14:20:00Z");

describe("retention arithmetic", () => {
  it.each([
    ["1h", "12 Nov 2026"],
    ["1d", "13 Nov 2026"],
    ["30d", "12 Dec 2026"],
    ["1y", "12 Nov 2027"],
  ] as const)("%s expires on %s", (code, expected) => {
    expect(formatDate(expiresAt(NOW, code)!)).toBe(expected);
  });

  it("never has no expiry and no purge date", () => {
    expect(expiresAt(NOW, "never")).toBeNull();
    expect(purgeAfter(NOW, "never")).toBeNull();
  });

  it("purges 30 days after expiry, not after creation", () => {
    // Catches conflating the two events, which is the mistake §6.3 is built around:
    // logical expiry and physical deletion are 30 days apart.
    expect(formatDate(purgeAfter(NOW, "30d")!)).toBe("11 Jan 2027");
  });

  it("covers every offered retention code", () => {
    for (const code of RETENTION_CODES) {
      expect(() => expiresAt(NOW, code)).not.toThrow();
    }
  });
});

describe("formatting is pinned to UTC", () => {
  // These assertions catch the formatter losing its explicit `timeZone: "UTC"`: the
  // ambient zone then applies and 14:20Z reads as some other wall-clock time.
  //
  // They cannot do it alone. An Intl formatter resolves its zone when it is
  // constructed, at module load, so mutating process.env.TZ inside a test is
  // ineffective — an earlier version of this file did exactly that and looked like it
  // varied the zone. On a machine whose local zone IS UTC these would pass even with
  // the pinning removed, so `pnpm test:tz` runs the whole suite under UTC+14 and is
  // the real guard. Verified by deleting the pinning: 4 failures here, 9 under TZ.
  it("renders the stored instant, not a local one", () => {
    const expiry = expiresAt(NOW, "30d")!;
    expect(formatDate(expiry)).toBe("12 Dec 2026");
    expect(formatTime(expiry)).toBe("14:20 UTC");
  });

  it("labels the zone it rendered in", () => {
    // A time shown without its zone is a time the reader assumes is theirs.
    expect(formatTime(NOW)).toMatch(/UTC$/);
  });
});

describe("sizes and counts", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1024, "1.0 KB"],
    [1_677_721, "1.6 MB"],
    [21_076_992, "20.1 MB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("separates thousands in line counts, which get compared down a column", () => {
    expect(formatCount(214_880)).toBe("214,880");
  });
});
