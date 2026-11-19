import { describe, expect, it } from "vitest";

import {
  liveCacheControl,
  maxAgeFor,
  MAX_AGE_SECONDS,
  noCache,
} from "@/lib/http/cache";

// Catches a cached 200 outliving its expiry (ARCHITECTURE §6.3).
//
// This is not a performance test. A paste with four seconds of retention left served
// with `max-age=60` means a browser or CDN answers with the content for 56 seconds after
// the paste stopped existing — and the product's one promise is that the link stops
// answering at a stated time. The failure is silent, happens only near a boundary, and
// looks like a caching quirk rather than a leak.

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const inSeconds = (n: number) => new Date(NOW + n * 1000).toISOString();

describe("maxAgeFor", () => {
  it("never exceeds the seconds remaining on the TTL", () => {
    // The whole rule, checked across the boundary rather than at one convenient point.
    for (const remaining of [0, 1, 4, 30, 59, 60, 61, 3600]) {
      const maxAge = maxAgeFor({ expiresAt: inSeconds(remaining), now: NOW });
      expect(maxAge, `${remaining}s remaining`).toBeLessThanOrEqual(remaining);
      expect(maxAge, `${remaining}s remaining`).toBeLessThanOrEqual(
        MAX_AGE_SECONDS,
      );
    }
  });

  it("caps at the ceiling for a long-lived paste", () => {
    // A year of retention still gets 60 seconds, because a moderator can remove a paste
    // at any moment and a takedown should bite within a minute.
    expect(maxAgeFor({ expiresAt: inSeconds(365 * 86_400), now: NOW })).toBe(
      MAX_AGE_SECONDS,
    );
  });

  it("caps at the ceiling for a paste that never expires", () => {
    expect(maxAgeFor({ expiresAt: null, now: NOW })).toBe(MAX_AGE_SECONDS);
  });

  it("returns zero once the expiry has passed", () => {
    // Not a negative number. A negative `max-age` is ignored by some caches rather than
    // treated as zero, which would leave the response cacheable by default.
    for (const past of [-1, -60, -86_400]) {
      expect(maxAgeFor({ expiresAt: inSeconds(past), now: NOW })).toBe(0);
    }
  });

  it("returns zero for a timestamp it cannot parse", () => {
    // Fail closed. An unparseable expiry is a bug somewhere upstream, and the safe
    // reading of "I do not know when this dies" is "do not cache it".
    expect(maxAgeFor({ expiresAt: "not a date", now: NOW })).toBe(0);
  });

  it("floors rather than rounds, so it cannot round up past the expiry", () => {
    // 4.9 seconds left must be 4, not 5. Rounding up puts the cache window one second
    // past the moment the paste stops answering, which is the bug in miniature.
    const maxAge = maxAgeFor({
      expiresAt: new Date(NOW + 4_900).toISOString(),
      now: NOW,
    });
    expect(maxAge).toBe(4);
  });
});

describe("liveCacheControl", () => {
  it("is private, because the response carries a per-request CSP nonce", () => {
    const header = liveCacheControl({ expiresAt: inSeconds(3600), now: NOW });

    // This asserted `public` first, reasoning that a paste is readable without a session
    // so a CDN should be able to cache it. That is true about access and wrong about the
    // CSP: the view page carries a per-request nonce in both the header and the body's
    // script tags, so a shared cache hands every reader the same nonce for the window.
    // A nonce an attacker can read from their own request and then rely on is not a nonce.
    expect(header).toContain("private");
    expect(header).not.toContain("public");
    expect(header).toContain(`max-age=${MAX_AGE_SECONDS}`);
    expect(header).toContain("must-revalidate");
  });

  it("refuses to cache at all once the paste has lapsed", () => {
    expect(liveCacheControl({ expiresAt: inSeconds(-1), now: NOW })).toBe(
      noCache(),
    );
  });

  it("tracks the TTL below the ceiling", () => {
    expect(liveCacheControl({ expiresAt: inSeconds(12), now: NOW })).toContain(
      "max-age=12",
    );
  });
});

describe("noCache", () => {
  it("includes no-store, so a tombstone is never reused", () => {
    // A moderator can un-expire a paste inside the grace window (§6.4). A cached 410
    // would outlive the decision that reversed it, and the reader has no way to know.
    expect(noCache()).toContain("no-store");
    expect(noCache()).toContain("max-age=0");
  });
});
