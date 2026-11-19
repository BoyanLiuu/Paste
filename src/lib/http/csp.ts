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

/**
 * The Clerk UI pages, and ONLY those (ARCHITECTURE §6.5).
 *
 * `ClerkProvider` loads `clerk.browser.js` from the instance's own frontend-API origin, so
 * that origin has to be in `script-src` wherever the provider renders. Measured on the
 * running server after `clerk init`: with the provider in the root layout, `/p/:id` pulled
 * that remote script — a third-party origin on the page whose entire job is rendering
 * attacker-supplied text. The provider now lives in a layout covering these two routes,
 * and this is the policy they get.
 *
 * `'unsafe-inline'` for styles, because Clerk's components inject them. That is precisely
 * why this is a separate policy rather than an addition to `viewCsp`: one global policy
 * written to satisfy Clerk would hand `'unsafe-inline'` to the view page, which is the
 * thing the whole section exists to prevent.
 *
 * THE ORIGIN IS DERIVED FROM THE PUBLISHABLE KEY, not hardcoded. The key is
 * `pk_(test|live)_<base64 of the frontend API host>$`, so decoding it gives this
 * instance's host — and a development and a production instance differ. Hardcoding
 * a specific instance host would work today and silently break on the first
 * deploy, with Clerk's own script blocked by our own header.
 */
export function clerkFrontendOrigin(): string | null {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encoded = key.replace(/^pk_(test|live)_/, "");
  if (encoded === "" || encoded === key) return null;

  try {
    const host = Buffer.from(encoded, "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) && host.includes(".")
      ? `https://${host}`
      : null;
  } catch {
    return null;
  }
}

export function clerkCsp(): string {
  const origin = clerkFrontendOrigin();
  // Unset or unparseable: fall back to the strict policy rather than a permissive one. A
  // broken sign-in page is a visible failure; a wildcard script-src is not.
  const script = origin === null ? "'self'" : `'self' ${origin}`;

  return [
    "default-src 'none'",
    `script-src ${script}`,
    // Clerk's components inject styles and load images from its CDN.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https://img.clerk.com data:",
    `connect-src 'self'${origin === null ? "" : ` ${origin}`} https://clerk-telemetry.com`,
    "font-src 'self'",
    "form-action 'self'",
    // Clerk renders its CAPTCHA in a frame on the instance origin.
    `frame-src ${origin === null ? "'none'" : origin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "worker-src 'self' blob:",
  ].join("; ");
}

/** The raw origin. `sandbox` with no allow-list means the response has no origin
 *  privileges at all — defence in depth for the case where content-type handling
 *  fails, which is the failure this endpoint's separate domain exists for. */
export const RAW_CSP = "sandbox";

// Cache headers live in `@/lib/http/cache`, not here.
//
// This module had its own `cacheControlFor` and a `TOMBSTONE_CACHE_CONTROL` of
// `public, max-age=3600`, and both were wrong in ways that only show up side by side with
// the page's headers:
//
//   - It was a second implementation of `min(60, ttl)`, free to drift from the first.
//   - An hour-long cached tombstone contradicts the grace window. A moderator can
//     un-expire a paste for 30 days after it lapses (§6.4), and a cached 410 outlives the
//     decision that reversed it — on the endpoint a script is most likely to retry.
//
// Tombstones are now `no-store` on both the page and the raw origin.
