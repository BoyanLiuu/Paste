// Content-Security-Policy, per page rather than globally.
//
// The view page renders attacker-supplied text as its primary function, so it gets the
// strictest policy in the product. A single global policy written to satisfy Clerk —
// which M10 adds — would loosen exactly the page this exists to protect, which is why
// these are separate values rather than one with exceptions (§6.5).

/**
 * The view page and its tombstones. Nothing loads, nothing runs, except our own
 * script and stylesheet.
 *
 * **The nonce is not optional.** React's streaming completes a Suspense boundary by
 * writing the resolved markup into a hidden `<div>` and relocating it with an inline
 * `<script>`. Under a bare `script-src 'self'` that script is blocked, the div keeps
 * `display: none`, and the page renders an empty box — which is exactly what happened
 * when this policy was first applied. Next stamps the nonce onto its own scripts when
 * middleware supplies one, so the inline bootstrap runs and an injected one still
 * cannot.
 *
 * `style-src 'self'` with no `'unsafe-inline'` is achievable only because the render
 * script moves Shiki's per-token styles into generated classes — the CSS-variables
 * theme alone does not do it. See scripts/render-fixtures.mts.
 *
 * KNOWN, ACCEPTED VIOLATION. Eight of the nine inline scripts on this page carry the
 * nonce; React emits one without it — `requestAnimationFrame(function(){$RT=
 * performance.now()})`, the timing instrumentation it uses to tune when a streamed
 * boundary is revealed. It is blocked, and the console logs one violation per load.
 * Nothing breaks: the content renders and the range selection works, verified.
 *
 * Deliberately not silenced with its hash. A `sha256-` entry would pin this header to
 * one React build, and the thing it would re-enable is reveal-timing cosmetics — a
 * volatile hash in a security header is a worse trade than a known log line. The cost
 * is real though: a violation on every load is noise that could hide a new one, so
 * M12's security suite should assert the violation set is *exactly* this one rather
 * than asserting it is empty.
 */
export function viewCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** The raw origin. `sandbox` with no allow-list means the response has no origin
 *  privileges at all — defence in depth for the case where content-type handling
 *  fails, which is the failure this endpoint's separate domain exists for. */
export const RAW_CSP = "sandbox";

/** Capped at the remaining TTL, so a cached 200 cannot outlive the expiry it was
 *  cached before. Sixty seconds is the ceiling, not the value (§6.3). */
export function cacheControlFor(expiresAt: string | null): string {
  if (expiresAt === null) return "public, max-age=60, must-revalidate";
  const seconds = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
  if (seconds <= 0) return "no-store";
  return `public, max-age=${Math.min(60, seconds)}, must-revalidate`;
}

/** Once gone, always gone, so a tombstone is free to cache for an hour. */
export const TOMBSTONE_CACHE_CONTROL = "public, max-age=3600";
