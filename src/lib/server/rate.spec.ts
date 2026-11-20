// @vitest-environment node

// The rate limit (ARCHITECTURE §4 stage 2, §6.1).
//
// The property that matters is not "a limit exists" but WHEN it is charged. The scanner
// is the expensive stage and it runs before the insert, so a refusal that costs nothing
// lets an attacker run the scanner without limit — and use it as an oracle, submitting
// near-miss bodies to learn what the rules match. The charge therefore commits before any
// work and is never refunded.

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { BlockedBySecretScan } from "@/lib/server/create-paste";
import {
  skipReason,
  slackTokenShape,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { createPaste } from "@/lib/server/mutations";
import { prisma } from "@/lib/server/prisma";
import { charge, DAY_CAPACITY, MINUTE_CAPACITY } from "@/lib/server/rate";

const reason = skipReason();

describe.skipIf(reason !== null)(
  `the rate limit${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("starts full and debits one token per attempt", async () => {
      await withTestOwner(async (owner) => {
        const first = await charge({ kind: "user", id: owner.userId });
        expect(first.ok).toBe(true);
        expect(first.remaining).toBe(MINUTE_CAPACITY - 1);

        const second = await charge({ kind: "user", id: owner.userId });
        expect(second.remaining).toBe(MINUTE_CAPACITY - 2);
      });
    });

    it("refuses once the minute bucket is empty, with a Retry-After", async () => {
      await withTestOwner(async (owner) => {
        for (let i = 0; i < MINUTE_CAPACITY; i += 1) {
          expect((await charge({ kind: "user", id: owner.userId })).ok).toBe(
            true,
          );
        }

        const refused = await charge({ kind: "user", id: owner.userId });
        expect(refused.ok).toBe(false);
        expect(refused.limit).toBe("minute");
        // Long enough for a whole token, so a client that honours the header does not
        // come straight back to another refusal.
        expect(refused.retryAfter).toBeGreaterThan(0);
        expect(refused.retryAfter).toBeLessThanOrEqual(60);
      });
    });

    it("charges a blocked paste, so a 422 is not free", async () => {
      await withTestOwner(async (owner) => {
        const before = await prisma.rateBucket.findUnique({
          where: { userId: owner.userId },
        });
        // No bucket until the first charge — created on first use rather than alongside
        // the user, because a user row can arrive from the seed or M10's Clerk webhook
        // and every one of those would otherwise have to remember to make one.
        expect(before).toBeNull();

        // Charge, then block, to assert the two are independent: the create path must
        // not refund a charge the route already committed.
        const charged = await charge({ kind: "user", id: owner.userId });
        expect(charged.ok).toBe(true);

        await expect(
          createPaste(owner.viewer, {
            body: `SLACK_TOKEN = "${slackTokenShape()}"\n`,
            retention: "1h",
          }),
        ).rejects.toThrow(BlockedBySecretScan);

        const after = await prisma.rateBucket.findUniqueOrThrow({
          where: { userId: owner.userId },
        });
        // Still spent. A refund here is the hole: the scan is the costly part and it has
        // already run.
        expect(after.minuteTokens).toBe(MINUTE_CAPACITY - 1);
        expect(after.dayCount).toBe(1);
      });
    });

    it("refills lazily rather than needing a sweeper", async () => {
      await withTestOwner(async (owner) => {
        for (let i = 0; i < MINUTE_CAPACITY; i += 1) {
          await charge({ kind: "user", id: owner.userId });
        }
        expect((await charge({ kind: "user", id: owner.userId })).ok).toBe(
          false,
        );

        // Rewind the refill clock instead of waiting. The refill is computed from
        // elapsed time at read, which is what removes the need for a scheduled job —
        // and a scheduled job's failure mode is that nobody can post anything.
        await prisma.rateBucket.update({
          where: { userId: owner.userId },
          data: { minuteRefilledAt: new Date(Date.now() - 61_000) },
        });

        const after = await charge({ kind: "user", id: owner.userId });
        expect(after.ok).toBe(true);
        // A full minute restores a full bucket, less the token just spent.
        expect(after.remaining).toBe(MINUTE_CAPACITY - 1);
      });
    });

    it("does not let sub-token refills accumulate into a free one", async () => {
      await withTestOwner(async (owner) => {
        for (let i = 0; i < MINUTE_CAPACITY; i += 1) {
          await charge({ kind: "user", id: owner.userId });
        }

        // Each of these is well under one token's worth of time. Storing fractional
        // tokens would let repeated near-instant retries bank them into a free attempt,
        // which is why the write floors.
        for (let i = 0; i < 5; i += 1) {
          await prisma.rateBucket.update({
            where: { userId: owner.userId },
            data: { minuteRefilledAt: new Date(Date.now() - 1_000) },
          });
          const result = await charge({ kind: "user", id: owner.userId });
          // 1 s at 20 tokens/minute is a third of a token.
          expect(result.ok).toBe(false);
        }
      });
    });

    it("resets the day counter on a UTC date change, not a local one", async () => {
      await withTestOwner(async (owner) => {
        await charge({ kind: "user", id: owner.userId });

        await prisma.rateBucket.update({
          where: { userId: owner.userId },
          data: {
            dayCount: DAY_CAPACITY,
            // Yesterday in UTC. A local midnight would need a timezone per user and
            // would let someone travel into a fresh quota.
            dayStartedAt: new Date(Date.now() - 36 * 60 * 60 * 1000),
            minuteTokens: MINUTE_CAPACITY,
            minuteRefilledAt: new Date(),
          },
        });

        const after = await charge({ kind: "user", id: owner.userId });
        expect(after.ok).toBe(true);

        const row = await prisma.rateBucket.findUniqueOrThrow({
          where: { userId: owner.userId },
        });
        expect(row.dayCount).toBe(1);
      });
    });

    it("refuses on the day ceiling even with a full minute bucket", async () => {
      await withTestOwner(async (owner) => {
        await charge({ kind: "user", id: owner.userId });
        await prisma.rateBucket.update({
          where: { userId: owner.userId },
          data: {
            dayCount: DAY_CAPACITY,
            dayStartedAt: new Date(),
            minuteTokens: MINUTE_CAPACITY,
            minuteRefilledAt: new Date(),
          },
        });

        const refused = await charge({ kind: "user", id: owner.userId });
        expect(refused.ok).toBe(false);
        // The day ceiling is checked first, so the message names the right limit. Saying
        // "too many in the last minute" to someone who has hit a daily cap sends them
        // back in sixty seconds to the same refusal.
        expect(refused.limit).toBe("day");
        expect(refused.retryAfter).toBeGreaterThan(0);
      });
    });

    it("does not double a quota under concurrent attempts", async () => {
      await withTestOwner(async (owner) => {
        await charge({ kind: "user", id: owner.userId });
        await prisma.rateBucket.update({
          where: { userId: owner.userId },
          data: { minuteTokens: 4, minuteRefilledAt: new Date() },
        });

        // Ten at once against four tokens. Two requests both reading 4 and both writing
        // 3 is how a limit of 20 becomes a limit of 40 under exactly the load the limit
        // exists for, so the debit is a single conditional UPDATE and the row lock
        // serialises them.
        const results = await Promise.all(
          Array.from({ length: 10 }, () =>
            charge({ kind: "user", id: owner.userId }),
          ),
        );

        // EXACTLY four, not "at most four". The earlier SERIALIZABLE version could only
        // promise an upper bound, because its own false conflicts refused charges that
        // should have succeeded — so an implementation that granted two would also have
        // passed. One statement has no such excuse.
        expect(results.filter((r) => r.ok)).toHaveLength(4);
        expect(results.filter((r) => !r.ok)).toHaveLength(6);

        const row = await prisma.rateBucket.findUniqueOrThrow({
          where: { userId: owner.userId },
        });
        expect(row.minuteTokens).toBeGreaterThanOrEqual(0);
      });
    });
  },
);

describe.skipIf(reason !== null)(
  `charge by IP${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    /** A key no other test shares, so counts are exact. */
    function freshKey(): string {
      return `ip:${randomUUID().replaceAll("-", "")}${"0".repeat(32)}`.slice(
        0,
        67,
      );
    }

    it("charges an address with no user row behind it", async () => {
      // THE WHOLE POINT OF THE SECOND TABLE. `rate_buckets` is keyed on a uuid with a
      // foreign key to `users`, so an anonymous caller had nothing to charge — which is
      // why there was no throttle at all for anyone without an account.
      const hash = freshKey();
      const first = await charge({ kind: "ip", hash });

      expect(first.ok).toBe(true);
      expect(first.remaining).toBe(MINUTE_CAPACITY - 1);
    });

    it("keeps the account bucket and the address bucket independent", async () => {
      // THE DEFECT THIS CATCHES: one shared table, or a key collision between the two,
      // makes every create cost two tokens from one bucket — halving the published limit
      // for everyone while both call sites look correct.
      await withTestOwner(async (owner) => {
        const hash = freshKey();

        const user = await charge({ kind: "user", id: owner.userId });
        const ip = await charge({ kind: "ip", hash });

        expect(user.remaining).toBe(MINUTE_CAPACITY - 1);
        expect(ip.remaining).toBe(MINUTE_CAPACITY - 1);

        // And charging one does not move the other.
        await charge({ kind: "ip", hash });
        const userAgain = await charge({ kind: "user", id: owner.userId });
        expect(userAgain.remaining).toBe(MINUTE_CAPACITY - 2);
      });
    });

    it("refuses an address once its minute bucket is empty", async () => {
      // The limit actually limiting. Charged to exhaustion rather than asserted from the
      // arithmetic, because the arithmetic is in SQL and that is the part under test.
      const hash = freshKey();

      for (let i = 0; i < MINUTE_CAPACITY; i += 1) {
        const decision = await charge({ kind: "ip", hash });
        expect(decision.ok, `charge ${i + 1} of ${MINUTE_CAPACITY}`).toBe(true);
      }

      const refused = await charge({ kind: "ip", hash });
      expect(refused.ok).toBe(false);
      expect(refused.limit).toBe("minute");
      expect(refused.retryAfter).toBeGreaterThan(0);
    });

    it("refuses two addresses independently", async () => {
      // One address exhausting its bucket must not refuse another. A missing key in the
      // WHERE clause would make the first caller of the minute lock everybody out.
      const a = freshKey();
      const b = freshKey();

      for (let i = 0; i < MINUTE_CAPACITY; i += 1)
        await charge({ kind: "ip", hash: a });
      expect((await charge({ kind: "ip", hash: a })).ok).toBe(false);
      expect((await charge({ kind: "ip", hash: b })).ok).toBe(true);
    });
  },
);
