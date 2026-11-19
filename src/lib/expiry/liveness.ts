// THE liveness rule. One definition, three call sites (ARCHITECTURE §6.3).
//
// This module exists because the rule was written three times and the copies disagreed:
//
//   livenessOf      the page and the raw route, deciding what gets rendered
//   pasteLiveness   the proxy, deciding the status code
//   liveWhere       SQL, filtering a list without fetching it
//
// They disagreed about `state = 'redacted'`, and the disagreement went the opposite way
// from how it first looked. A REDACTION IS NOT A REMOVAL: the offending bytes are purged
// from revision 1, a revision 2 carries the cleaned text, and that text is served with a
// permanent notice (`RedactionNotice`, and the designed fixture `Wq8nZ4Fc`). So `redacted`
// is a live state.
//
// `livenessOf` had this right. The copies written for M8 did not: the proxy answered 410
// for a paste whose page renders content — a 410 carrying a body — and the list filter hid
// it from the "live" tab. Both were new regressions, and the fixture-liveness test is what
// caught them, because it asserts every designed state still resolves to the state it was
// designed for.
//
// Two copies of a rule disagree eventually; three disagree sooner. M9's sweeper is the
// first thing that WRITES `state`, so it had to be one rule before that landed.

/**
 * States in which a paste serves no content, whatever its expiry says.
 *
 * NOT `redacted` — see above. A redacted paste serves its cleaned revision.
 *
 * Exported so the SQL predicate is built from the same list the TypeScript check uses:
 * the two cannot drift if neither owns its own copy.
 */
export const GONE_STATES = ["expired", "purged"] as const;

export type GoneState = (typeof GONE_STATES)[number];

export type Liveness =
  /** Serve the content. */
  | { kind: "live" }
  /** 410 with a receipt. The bytes may or may not still exist; either way the reader gets
   *  the same shape of answer. */
  | { kind: "gone"; reason: "expired" | "purged" | "removed" };

/**
 * The columns the rule reads, accepted as either strings or Dates.
 *
 * Both shapes are real: the domain `Paste` carries ISO strings because they cross the RSC
 * boundary, and the proxy's narrow probe reads `Date` straight from the driver. Converting
 * at one of the two call sites would mean the rule still had two entry points.
 */
export interface LivenessInput {
  state: string;
  expiresAt: string | Date | null;
  purgeAfter: string | Date | null;
  /** Set by a moderator decision (M11). Absent on the proxy's narrow read. */
  removedBy?: unknown;
}

function asMillis(value: string | Date | null): number | null {
  if (value === null) return null;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * What a reader gets, recomputing expiry rather than trusting `state`.
 *
 * This is the authoritative check. The sweeper converges `state` on its own schedule, so a
 * paste whose `expires_at` has passed must answer gone even while the row still says
 * "live" — which is exactly what lets the cron run daily instead of every minute.
 *
 * The order of the checks is the rule: a removal wins over any expiry, and only then does
 * the clock get consulted. A redaction is not in that set — it changes what the body says,
 * not whether there is one.
 */
export function livenessFrom(input: LivenessInput, now = Date.now()): Liveness {
  if (input.removedBy !== null && input.removedBy !== undefined) {
    return { kind: "gone", reason: "removed" };
  }
  if (input.state === "purged") return { kind: "gone", reason: "purged" };
  // `redacted` deliberately falls through to the clock check: it is a live state.

  const expiresAt = asMillis(input.expiresAt);
  const lapsed = expiresAt !== null && expiresAt <= now;

  if (lapsed || input.state === "expired") {
    // Past the purge date the bytes are gone too, whatever the sweeper has got to.
    const purgeAfter = asMillis(input.purgeAfter);
    const purged = purgeAfter !== null && purgeAfter <= now;
    return { kind: "gone", reason: purged ? "purged" : "expired" };
  }

  return { kind: "live" };
}

/** Whether this paste would serve content right now. */
export function isLive(input: LivenessInput, now = Date.now()): boolean {
  return livenessFrom(input, now).kind === "live";
}
