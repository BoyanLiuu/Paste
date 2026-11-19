// "A reader would get content right now", as a Prisma WHERE (ARCHITECTURE §6.3).
//
// Its own module, for two reasons.
//
// First, the service's exported surface is a contract: `service-contract.spec.ts` asserts
// every exported function there is `async` and takes the viewer first, because that is
// what let M8 swap fixtures for queries without touching a call site. A synchronous
// predicate helper exported from that file breaks the guard for everything.
//
// Second, this is a DUPLICATE of `livenessOf`, and duplicates should be visible. That one
// is authoritative for a single paste on the read path; this is the same rule as SQL, so
// a list of 40 000 is filtered by the database instead of being fetched and filtered in
// JavaScript. Two expressions of one rule drift silently, and the symptom is a list
// offering a paste the view page then refuses — so `expiry-on-read.spec.ts` asserts they
// agree on the awkward cases rather than trusting that they do.

import "server-only";

import { GONE_STATES } from "@/lib/expiry/liveness";

/**
 * Pastes that would serve content at `now`.
 *
 * `expiresAt > now` rather than `state = 'live'`. The sweeper converges `state` on its
 * own schedule, so a paste whose expiry has passed is gone to a reader while the column
 * still says live — which is precisely what lets the cron run daily instead of every
 * minute. Grouping or filtering by `state` would report whatever the sweeper last wrote.
 */
export function liveWhere(now: Date) {
  return {
    // Built from the shared list, so this predicate and `livenessFrom` cannot disagree
    // about which states mean gone. They did: `redacted` was in this list and missing from
    // the TypeScript check, so the list hid a paste the page still rendered.
    state: { notIn: [...GONE_STATES] },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}
