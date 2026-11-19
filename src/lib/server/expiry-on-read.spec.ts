// @vitest-environment node

// The stale-state bug (ARCHITECTURE §6.3), which is what makes a daily sweeper safe.
//
// `state` is a column the sweeper converges on its own schedule. `expires_at` is the
// truth. A paste whose expiry passed four seconds ago must be gone to a reader even
// though no job has touched the row — and if that is not true, then the sweeper has to
// run every minute, and a late cron run becomes a content leak rather than a tidying
// delay.
//
// There are now THREE expressions of this one rule, and that is the real risk this file
// exists for:
//
//   livenessOf          one paste, in the page, authoritative for what gets rendered
//   liveWhere           SQL, so a list of 40 000 is filtered by the database
//   pasteLiveness       four columns, in the proxy, because only it can set the status
//
// Disagreement between any two is a 410 serving content, a 200 serving a tombstone, or a
// list offering a paste the view page then refuses. So every case below is checked against
// all three rather than against whichever one is convenient.

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
