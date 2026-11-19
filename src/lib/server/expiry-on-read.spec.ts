// @vitest-environment node

// The stale-state bug (ARCHITECTURE §6.3), which is what makes a daily sweeper safe.
//
// `state` is a column the sweeper converges on its own schedule. `expires_at` is the
// truth. A paste whose expiry passed four seconds ago must be gone to a reader even
// though no job has touched the row — and if that is not true, then the sweeper has to
// run every minute, and a late cron run becomes a content leak rather than a tidying
// delay.
//
// Three call sites read this rule, and all three now delegate to one definition in
// `@/lib/expiry/liveness`:
//
//   livenessOf          one paste, in the page and the raw route, deciding what renders
//   liveWhere           SQL, so a list of 40 000 is filtered by the database
//   pasteLiveness       four columns, in the proxy, because only it can set the status
//
// They were three separate implementations until M9, and two of them had drifted — see
// that module. Disagreement between any two is a 410 serving content, a 200 serving a
// tombstone, or a list offering a paste the view page then refuses. Every case below is
// still checked against all three: sharing a definition is not proof that each call site
// passes it the right columns.

import { describe, expect, it } from "vitest";

import { livenessOf } from "@/lib/expiry/tombstone";
import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { clearLivenessMemo, pasteLiveness } from "@/lib/server/liveness-probe";
import { getPaste, listPastes } from "@/lib/server/paste-service";
import type { Viewer } from "@/lib/types";

const VIEWER: Viewer = { kind: "anon" };
const reason = skipReason();

/** Each case names what the three implementations must all conclude. */
const CASES = [
  {
    name: "lapsed while the state column still says live",
    seed: { expiresInMinutes: -1, state: "live" },
    live: false,
  },
  {
    name: "expiring in an hour",
    seed: { expiresInMinutes: 60, state: "live" },
    live: true,
  },
  {
    name: "never expires",
    seed: { expiresInMinutes: null, state: "live" },
    live: true,
  },
  {
    name: "swept to expired but still inside the purge window",
    seed: { expiresInMinutes: -60, state: "expired" },
    live: false,
  },
  {
    name: "purged",
    seed: { expiresInMinutes: -60, state: "purged" },
    live: false,
  },
  {
    // THE CASE THIS FILE WAS MISSING, and the one that let two M8 regressions through.
    // A redaction purges the offending bytes from revision 1 and serves a cleaned revision
    // 2 with a permanent notice, so `redacted` is a LIVE state. The proxy answered 410 for
    // it — a 410 carrying a body — and the list filter hid it from the live tab.
    name: "redacted with a future expiry still serves its cleaned revision",
    seed: { state: "redacted", expiresInMinutes: 60 },
    live: true,
  },
  {
    // And a redaction does not exempt a paste from its own expiry.
    name: "redacted and lapsed is gone like anything else",
    seed: { state: "redacted", expiresInMinutes: -1 },
    live: false,
  },
  {
    name: "state says expired while the expiry is still in the future",
    // Contradictory on purpose: a moderator expired it early. `state` is the stricter
    // answer here, and all three must take it rather than trusting the clock alone.
    seed: { expiresInMinutes: 60, state: "expired" },
    live: false,
  },
] as const;

describe.skipIf(reason !== null)(
  `expiry on read${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it.each(CASES)("$name", async ({ seed, live }) => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        const [id] = await seedPastes(owner.userId, [seed]);

        // 1. The page's check, on the full row.
        const paste = await getPaste(VIEWER, id);
        expect(paste).not.toBeNull();
        expect(livenessOf(paste!).kind === "live", "livenessOf").toBe(live);

        // 2. The proxy's check, on four columns.
        const probe = await pasteLiveness(id);
        expect(probe.verdict, "pasteLiveness").toBe(live ? "live" : "gone");

        // 3. The SQL predicate, via the list filter.
        const liveList = await listPastes(VIEWER, owner.username, {
          filter: "live",
        });
        expect(
          liveList.items.some((p) => p.id === id),
          "liveWhere",
        ).toBe(live);
      });
    });

    it("answers unknown for an id no paste has ever had", async () => {
      clearLivenessMemo();
      // Distinct from "gone", and the distinction is the product: a 404 for a lapsed
      // paste breaks every citing document, and a 410 for an id that never existed lets
      // anyone mint a plausible receipt.
      const probe = await pasteLiveness("zzzzzzzz");
      expect(probe.verdict).toBe("unknown");
    });

    it("never caches a verdict past the expiry it was computed against", async () => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        // Two seconds of life. The memo's own window is five, so a blanket TTL would keep
        // serving "live" for three seconds after this paste was gone — the one direction
        // in which a stale memo is a content leak rather than a cosmetic error.
        const [id] = await seedPastes(owner.userId, [
          { expiresInMinutes: 2 / 60 },
        ]);

        const before = await pasteLiveness(id);
        expect(before.verdict).toBe("live");

        // Ask again as of a moment after the expiry, without clearing the memo. The entry
        // must already have been dropped.
        const after = await pasteLiveness(id, Date.now() + 3_000);
        expect(after.verdict).toBe("gone");
      });
    });

    it("carries the expiry so the cache window can be bounded without a second query", async () => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        const [id] = await seedPastes(owner.userId, [{ expiresInMinutes: 30 }]);

        const probe = await pasteLiveness(id);
        expect(probe.verdict).toBe("live");
        expect(probe.expiresAt).not.toBeNull();
        expect(Date.parse(probe.expiresAt!)).toBeGreaterThan(Date.now());
      });
    });
  },
);
