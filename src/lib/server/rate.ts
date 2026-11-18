// The create path's rate limit (ARCHITECTURE §4 stage 2, §6.1).
//
// CHARGED ON ATTEMPTS, NOT ON SUCCESSES, and committed in its own transaction before any
// work happens. Both halves matter:
//
//   - If the charge rolled back with a rejected create, a 422 would be free. The scanner
//     is the expensive part of the request and it runs before the insert, so "free
//     failures" means an attacker can run the scanner without limit — and can brute-force
//     it as an oracle, submitting near-miss bodies to learn what the rules match.
//   - If the charge committed only on success, the same hole exists with extra steps.
//
// So the bucket is debited, committed, and never refunded. A user who hits their limit
// through their own failed attempts has still consumed the work.

import "server-only";

import { prisma } from "@/lib/server/prisma";

/** Tokens in a full bucket, and the per-minute ceiling. */
export const MINUTE_CAPACITY = 20;

/** Tokens restored per millisecond, so a full bucket refills in one minute. */
const REFILL_PER_MS = MINUTE_CAPACITY / 60_000;

/** The daily ceiling, which the minute bucket cannot express. */
export const DAY_CAPACITY = 500;

export interface RateDecision {
  ok: boolean;
  /** Tokens left after this charge, for the `X-RateLimit-Remaining` header. */
  remaining: number;
  /** Seconds until the next token, for `Retry-After`. Only set when refused. */
  retryAfter: number;
  /** Which ceiling refused, so the message can say which one. */
  limit: "minute" | "day" | null;
}

/** Tokens restored per second, for the SQL below. */
const REFILL_PER_SEC = MINUTE_CAPACITY / 60;

/**
 * Charge one token, or refuse.
 *
 * A LAZY token bucket: there is no sweeper and no key expiry to reason about, because the
 * refill is computed from elapsed time at read. A scheduled job topping every bucket up
 * adds a moving part that can fail silently, and its failure mode is that nobody can post
 * anything.
 *
 * ONE CONDITIONAL UPDATE, NOT A TRANSACTION.
 *
 * The first version read the row, decided in TypeScript, then wrote — wrapped in a
 * SERIALIZABLE transaction, because two requests both reading 1 token and both writing 0
 * is how a limit of 20 becomes a limit of 40. That was the right problem and the wrong
 * tool, and the tests found it: under SERIALIZABLE, Postgres takes predicate locks on
 * index pages, so concurrent charges by *different users* conflicted and failed with
 * 40001. The create path would have become flaky under exactly the load a rate limit
 * exists for — and the retry it demands is itself a second charge.
 *
 * A single statement needs none of that. The row lock serialises concurrent charges
 * against the same bucket, Postgres re-evaluates the WHERE against the committed row
 * after the lock is released, and two different users never touch the same row.
 */
export async function charge(userId: string): Promise<RateDecision> {
  // The bucket, created on first use rather than alongside the user: a user row can
  // arrive from the seed or from M10's Clerk webhook, and every one of those paths would
  // otherwise have to remember to make a bucket. `ON CONFLICT DO NOTHING` so this is a
  // no-op once it exists and never contends.
  await prisma.$executeRaw`
    INSERT INTO paste.rate_buckets
      (user_id, minute_tokens, minute_refilled_at, day_count, day_started_at)
    VALUES
      (${userId}::uuid, ${MINUTE_CAPACITY}, now(), 0, (now() AT TIME ZONE 'UTC')::date)
    ON CONFLICT (user_id) DO NOTHING`;

  // Every column reference is to the row being updated, with no CTE holding a stale
  // snapshot — that distinction is what makes this safe. A `WITH refilled AS (SELECT …)`
  // version reads the same, and loses the race: the CTE is evaluated once against the
  // starting snapshot, so a blocked second charge would unblock and apply arithmetic
  // computed from the pre-update row.
  const rows = await prisma.$queryRaw<
    { minute_tokens: number; day_count: number }[]
  >`
    UPDATE paste.rate_buckets
       SET minute_tokens =
             FLOOR(LEAST(
               ${MINUTE_CAPACITY}::numeric,
               minute_tokens + EXTRACT(EPOCH FROM (now() - minute_refilled_at))
                               * ${REFILL_PER_SEC}::numeric
             )) - 1,
           minute_refilled_at = now(),
           day_count = CASE
             WHEN day_started_at <> (now() AT TIME ZONE 'UTC')::date THEN 1
             ELSE day_count + 1
           END,
           day_started_at = (now() AT TIME ZONE 'UTC')::date
     WHERE user_id = ${userId}::uuid
       -- A whole token must be available. FLOOR on write means a fractional remainder is
       -- discarded rather than banked, so repeated near-instant retries cannot
       -- accumulate sub-token refills into a free attempt.
       AND LEAST(
             ${MINUTE_CAPACITY}::numeric,
             minute_tokens + EXTRACT(EPOCH FROM (now() - minute_refilled_at))
                             * ${REFILL_PER_SEC}::numeric
           ) >= 1
       -- The day ceiling, reset on a UTC date change. UTC rather than the user's zone:
       -- a local midnight needs a timezone per user and would let someone travel into a
       -- fresh quota.
       AND (day_started_at <> (now() AT TIME ZONE 'UTC')::date
            OR day_count < ${DAY_CAPACITY})
    RETURNING minute_tokens, day_count`;

  if (rows.length === 1) {
    return {
      ok: true,
      remaining: Number(rows[0].minute_tokens),
      retryAfter: 0,
      limit: null,
    };
  }

  // Refused. Which ceiling is a second read, which is fine: a refusal is the rare path
  // and nothing about it needs to be atomic — the charge already did not happen.
  return describeRefusal(userId);
}

/**
 * Why the charge was refused, and how long to wait.
 *
 * Separated because it is advisory. Reporting "too many in the last minute" to someone
 * who has hit a daily cap sends them back in sixty seconds to the same refusal, so the
 * distinction is worth a second query.
 */
async function describeRefusal(userId: string): Promise<RateDecision> {
  const now = new Date();
  const bucket = await prisma.rateBucket.findUnique({ where: { userId } });

  if (bucket === null) {
    // The insert above guarantees a row, so this means it was deleted between the two
    // statements. Refuse rather than invent a quota.
    return { ok: false, remaining: 0, retryAfter: 1, limit: "minute" };
  }

  const sameDay = isSameUtcDay(bucket.dayStartedAt, now);
  if (sameDay && bucket.dayCount >= DAY_CAPACITY) {
    return {
      ok: false,
      remaining: 0,
      retryAfter: secondsUntilNextUtcDay(now),
      limit: "day",
    };
  }

  const elapsedMs = now.getTime() - bucket.minuteRefilledAt.getTime();
  const refilled = Math.min(
    MINUTE_CAPACITY,
    bucket.minuteTokens + elapsedMs * REFILL_PER_MS,
  );

  return {
    ok: false,
    remaining: 0,
    // Time for one whole token, so a client that honours this does not come straight
    // back to another refusal.
    retryAfter: Math.max(1, Math.ceil((1 - refilled) / REFILL_PER_MS / 1000)),
    limit: "minute",
  };
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function secondsUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.ceil((next - now.getTime()) / 1000);
}
