import { describe, expect, it } from "vitest";

import { livenessOf } from "@/lib/expiry/tombstone";
import { PASTES, PASTES_BY_ID } from "@/lib/fixtures";

// Catches the fixture rot that made a designed screen unreachable.
//
// Fixture dates were originally absolute, authored around 12 Nov 2026. §6.3 requires
// expiry be recomputed against the real clock rather than trusted from `state`, so six
// days later every 1-hour and 1-day paste had genuinely expired — and the designed
// "live log paste" screen rendered a 410 receipt instead. The dates are relative now,
// and this pins each one to the state it was designed for so the drift cannot return.

/** What each fixture exists to demonstrate. A screen nobody can reach is a screen
 *  nobody reviews. */
const DESIGNED: Record<string, "live" | "expired" | "purged" | "removed"> = {
  Kp2sM7aJ: "live", // truncated: first 500 of 214,880 lines
  R3vKd9Tb: "live", // a log, highlighted
  Bz8fQ1kW: "live", // plain text, expiring soon
  Tn6yB3xH: "live", // highlighting off, 18,420 lines
  "7fK2mQxZ": "live", // the canonical Python paste
  Wq8nZ4Fc: "live", // redacted, revision 2 — still readable
  Ld5gP9cV: "live", // never expires
  Jc3tV6nP: "live", // 1-year retention
  Hx7pL2wE: "live", // a fork
  Mx5rT2aB: "live", // the paste the open secret request is about
  Gt6mY3hR: "live", // another owner's paste
  Ex4hN8qR: "expired", // lapsed, bytes still present, un-expirable by a moderator
  Pg7wC2mK: "purged", // bytes gone, hash survives
  Vy2kH7dL: "removed", // taken down early by a moderator
};

describe("fixture liveness", () => {
  it("covers every fixture", () => {
    // Guards the guard: a new fixture with no expectation would otherwise be able to
    // rot unnoticed.
    expect(Object.keys(DESIGNED).toSorted()).toEqual(
      PASTES.map((p) => p.id).toSorted(),
    );
  });

  it.each(Object.entries(DESIGNED))(
    "%s resolves to the %s state it was designed for",
    (id, expected) => {
      const liveness = livenessOf(PASTES_BY_ID[id]);
      const actual = liveness.kind === "live" ? "live" : liveness.reason;
      expect(actual).toBe(expected);
    },
  );

  it("keeps the shortest-lived paste comfortably live", () => {
    // Bz8fQ1kW has 1-day retention and is the closest to its expiry by design, so it
    // is the first screen that rot would take away.
    const paste = PASTES_BY_ID.Bz8fQ1kW;
    const remaining = Date.parse(paste.expiresAt!) - Date.now();
    expect(remaining).toBeGreaterThan(30 * 60_000);
  });

  it("keeps an expired paste's bytes until its purge date", () => {
    // The 30-day grace window is what lets a moderator bring back a paste someone's
    // incident review still cites (§6.3).
    const paste = PASTES_BY_ID.Ex4hN8qR;
    expect(paste.body).not.toBeNull();
    expect(Date.parse(paste.purgeAfter!)).toBeGreaterThan(Date.now());
  });
});
