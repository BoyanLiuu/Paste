// The cheapest possible "is this paste gone?", for the proxy (ARCHITECTURE §6.3).
//
// Separate from `paste-service.ts` because it answers a narrower question and must cost
// much less. The proxy runs on every /p/* request, including the hot path for live
// pastes, so this selects four columns from one primary-key lookup and nothing else — no
// revisions, no owner join, no body.
//
// It is NOT the authoritative check. The page still calls `livenessOf` on the full row
// and renders the tombstone from it; this only decides the status code, which the
// framework will not let a page set. Two expressions of one rule, so
// `expiry-on-read.spec.ts` asserts they agree — if they ever disagree the result is a
// 410 with content, or a 200 with a tombstone, and both are worse than either answer.

import "server-only";

import { livenessFrom } from "@/lib/expiry/liveness";
import { prisma } from "@/lib/server/prisma";

export type Verdict = "live" | "gone" | "unknown";

export interface Probe {
  verdict: Verdict;
  /** ISO, or null for "never" and for an id that does not exist. Carried so the proxy can
   *  bound `max-age` by the remaining TTL without a second query — the row is already in
   *  hand, and a cached 200 outliving its paste is the one cache bug that matters. */
  expiresAt: string | null;
}

/** A short-lived memo, keyed by id.
 *
 *  Expiry is deterministic from `expires_at`, which never changes for a live paste, so
 *  the verdict can only move one way: live → gone, at a time already known. Caching for
 *  a few seconds therefore cannot produce a wrong answer in the dangerous direction
 *  (content served after expiry) as long as the entry is dropped before the expiry it
 *  was computed against — which `expiresAt` below enforces per entry rather than by a
 *  blanket TTL.
 *
 *  Bounded because this is a module-level map in a long-lived server process: unbounded,
 *  it is a memory leak keyed by attacker-supplied ids. */
const MEMO_LIMIT = 500;
const MEMO_MS = 5_000;

interface Memo extends Probe {
  /** Drop at the earlier of: this memo going stale, or the paste's own expiry. */
  until: number;
}

const memo = new Map<string, Memo>();

export function clearLivenessMemo(): void {
  memo.clear();
}

export async function pasteLiveness(
  id: string,
  now = Date.now(),
): Promise<Probe> {
  const cached = memo.get(id);
  if (cached !== undefined && cached.until > now) {
    return { verdict: cached.verdict, expiresAt: cached.expiresAt };
  }

  const row = await prisma.paste.findUnique({
    where: { id },
    select: { state: true, expiresAt: true, purgeAfter: true },
  });

  const probe: Probe = {
    verdict: verdictFor(row, now),
    expiresAt: row?.expiresAt?.toISOString() ?? null,
  };

  // "unknown" is not cached. An id that does not exist yet may exist a second later, and
  // a paste created between this lookup and a reload must not be masked by a memo.
  if (probe.verdict !== "unknown") {
    if (memo.size >= MEMO_LIMIT) {
      // Drop the oldest insertion. A true LRU would need access tracking for a gain that
      // does not exist at this size.
      const oldest = memo.keys().next();
      if (!oldest.done) memo.delete(oldest.value);
    }

    // The clamp applies to a LIVE verdict only, and the asymmetry is the point.
    //
    // For a live paste, never cache past the moment the answer changes: otherwise content
    // is served as live for up to MEMO_MS after its expiry, the one direction in which a
    // stale memo is a leak rather than a cosmetic error.
    //
    // For a gone paste the expiry is already in the past, so clamping to it put `until`
    // behind `now` — the entry was written and was stale immediately, so gone pastes were
    // never memoised at all. They are exactly the ones that then pay for the proxy's
    // self-fetch, so the one verdict worth caching was the one that never was. A gone
    // paste can only become live again by a moderator un-expiring it inside the grace
    // window (§6.4), which is rare and tolerates five seconds.
    const expiry = row?.expiresAt?.getTime();
    memo.set(id, {
      ...probe,
      until:
        probe.verdict === "gone" || expiry === undefined || expiry === null
          ? now + MEMO_MS
          : Math.min(now + MEMO_MS, expiry),
    });
  }

  return probe;
}

/** Delegates to the one rule, so the status code and the rendered page cannot disagree. */
function verdictFor(
  row: {
    state: string;
    expiresAt: Date | null;
    purgeAfter: Date | null;
  } | null,
  now: number,
): Verdict {
  if (row === null) return "unknown";
  return livenessFrom(row, now).kind === "live" ? "live" : "gone";
}

/**
 * Whether a Clerk user moderates, by their Clerk id.
 *
 * Lives beside the liveness probe because it has the same shape and the same caller: a
 * narrow, single-column read the proxy needs before rendering starts. It takes the Clerk
 * id rather than a `Viewer` so `view-route.ts` can use it without importing Clerk —
 * importing `@clerk/nextjs/server` there drags Next's React client context into the
 * node-environment tests, which is why the proxy and the route logic are separate files
 * at all.
 */
export async function moderatesByClerkId(
  clerkUserId: string | null,
): Promise<boolean> {
  if (clerkUserId === null) return false;

  const row = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { isModerator: true },
  });

  return row?.isModerator ?? false;
}
