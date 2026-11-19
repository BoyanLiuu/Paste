// Cache headers for paste responses (ARCHITECTURE §6.3).
//
// THE RULE: a cached 200 must never outlive the paste it describes.
//
// A paste with four seconds left on its retention cannot be served with `max-age=60`,
// because a CDN or a browser would then answer with content for 56 seconds after the
// paste stopped existing. That is not a stale cache — it is the product's central promise
// failing silently, since the whole point of an expiry is that the content becomes
// unreachable at a stated time. The expiry is authoritative on read, so the cache window
// has to be bounded by the same clock.

/** The ceiling for a live paste. Short on purpose: a paste can be removed by a moderator
 *  at any moment, and a minute is the longest a takedown should take to bite. */
export const MAX_AGE_SECONDS = 60;

export interface CacheOptions {
  /** ISO timestamp, or null for a paste that never expires. */
  expiresAt: string | null;
  now?: number;
}

/**
 * Seconds a live response may be cached for.
 *
 * `min(60, seconds_until_expiry)`, floored at 0. A paste that never expires still gets
 * 60 rather than forever, because removal is always possible.
 */
export function maxAgeFor({
  expiresAt,
  now = Date.now(),
}: CacheOptions): number {
  if (expiresAt === null) return MAX_AGE_SECONDS;

  const remaining = Math.floor((Date.parse(expiresAt) - now) / 1000);
  if (Number.isNaN(remaining)) return 0;

  // Never negative: a lapsed paste should not be cached at all, and a negative max-age
  // is ignored by caches rather than treated as zero.
  return Math.max(0, Math.min(MAX_AGE_SECONDS, remaining));
}

/**
 * `Cache-Control` for a live paste.
 *
 * `private`, NOT `public`, and the reason is the CSP rather than access control.
 *
 * A paste is readable without a session (§3) — the id is the access control, not a
 * cookie — so `public` looks correct, and that is what this returned first. But the view
 * page carries a per-request CSP nonce (`src/proxy.ts`), in both the header and the script
 * tags of the body. A shared cache storing that response hands the same nonce to every
 * reader for the whole window, and a nonce reused across users is not a nonce: it is a
 * value an attacker can read once from their own request and then rely on.
 *
 * `private` keeps the TTL rule while confining the stored copy to one browser, where
 * sharing a nonce with yourself costs nothing. The repeat-view and back-button benefit
 * survives; only CDN caching is given up, on the one page that renders hostile text.
 *
 * `must-revalidate` so a cache does not serve the body past the window it was given,
 * which is the whole purpose of computing the window.
 */
export function liveCacheControl(options: CacheOptions): string {
  const maxAge = maxAgeFor(options);
  if (maxAge === 0) return noCache();
  return `private, max-age=${maxAge}, must-revalidate`;
}

/**
 * `Cache-Control` for the RAW origin, which may be shared-cached.
 *
 * `public` here and `private` for the HTML page, and the difference is the nonce rather
 * than the audience. Both serve the same bytes to anyone with the id; only the page
 * carries a per-request CSP nonce, and a shared cache storing that hands every reader the
 * same nonce for the window. `/raw` has no nonce, no cookies and `CSP: sandbox`, so there
 * is nothing per-request in the response to leak — and it is the endpoint most worth
 * caching, since the copy button and every CLI fetch go through it.
 */
export function rawCacheControl(options: CacheOptions): string {
  const maxAge = maxAgeFor(options);
  if (maxAge === 0) return noCache();
  return `public, max-age=${maxAge}, must-revalidate`;
}

/**
 * `Cache-Control` for a tombstone, and for anything whose answer must not be reused.
 *
 * A 410 is cached by some intermediaries by default, and a moderator un-expiring a paste
 * inside the grace window (§6.4) has to take effect immediately. The asymmetry is
 * deliberate: serving content too long is a leak, and serving a tombstone too long is
 * merely wrong, but both are avoidable here for free.
 */
export function noCache(): string {
  return "no-store, max-age=0, must-revalidate";
}
