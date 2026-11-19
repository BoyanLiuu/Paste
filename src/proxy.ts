import { NextResponse, type NextRequest } from "next/server";

import { liveCacheControl, noCache } from "@/lib/http/cache";
import { isPasteId } from "@/lib/ids";
import { viewCsp } from "@/lib/http/csp";
import { pasteLiveness } from "@/lib/server/liveness-probe";

// Two jobs on /p/*, both of which have to happen before the page renders.
//
// RENAMED FROM middleware.ts AT M8, and not cosmetically. Next 16 deprecates the
// `middleware` convention in favour of `proxy`, and the two differ in the way that
// decides whether this file can do its second job: `middleware.ts` is compiled for the
// Edge runtime (the build warns on every `node:` import), while `proxy.ts` defaults to
// Node. The database read below is only possible under the new name.
//
// 1. The view page's Content-Security-Policy, with a per-request nonce.
//
// Here rather than next.config's headers(), because the nonce has to change per request
// and a static header cannot. Next reads the nonce from the `script-src` directive on the
// REQUEST's CSP header and stamps it onto its own inline scripts — including the ones
// React streaming uses to relocate resolved Suspense content, which a bare
// `script-src 'self'` blocks outright (lib/http/csp.ts explains the failure).
//
// Scoped to /p/* on purpose. M10 adds a separate, looser entry for the pages rendering
// Clerk components. A single global policy would have to satisfy Clerk, which means
// loosening the one page that renders attacker-supplied text — the thing §6.5 exists to
// prevent.
//
// 2. The 410 for a paste that is gone (§6.3).
//
// A 404 for a lapsed paste breaks every document that cites the link; a 410 for an id
// that never existed lets anyone mint a plausible receipt for a paste that never was.
// Both answers are wrong in ways that surface years later, which is why this is worth a
// request to the database on the hot path.
//
// Getting the status onto the response took three attempts, and the two that failed are
// worth recording because each looks correct:
//
//   - `notFound()` in the page is the only status API a page has. The mechanism behind
//     `forbidden()`/`unauthorized()` validates against a hardcoded
//     `ALLOWED_CODES = {401, 403, 404}`, so a forged digest carrying 410 is rejected and
//     surfaces as a 500.
//   - `NextResponse.rewrite(url, { status: 410 })` from here. The rewrite happens and the
//     status is silently dropped: the route is partially prerendered, so the shell is
//     served with its own 200 (`x-nextjs-prerender: 1`) and the dynamic part streams in.
//
// What works is fetching the page and re-wrapping it. The tombstone stays the designed
// screen — rendered by the page, from the real row, inside the real layout — and this
// only replaces the status line. One extra internal request, on the rare path only.

export const config = {
  matcher: ["/p/:path*"],
};

/** Marks the proxy's own internal fetch, so it does not recurse into itself. */
const INTERNAL = "x-paste-internal";

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const csp = viewCsp(nonce);

  // Next looks for the nonce here, on the *request*, to apply it to its own scripts.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const passThrough = () => {
    const response = NextResponse.next({ request: { headers } });
    response.headers.set("content-security-policy", csp);
    return response;
  };

  // The inner half of the self-fetch below. Without this the proxy would call itself
  // forever, each call doing another database lookup.
  if (request.headers.get(INTERNAL) === "1") return passThrough();

  const id = request.nextUrl.pathname.split("/")[2];
  if (id === undefined || id === "") return passThrough();

  // A string that is not shaped like an id we ever issued cannot name a paste, so refuse
  // it without asking the database. This is also the cheap guard on the memo below: ids
  // are attacker-supplied, and an unbounded key space is a way to make a server process
  // allocate on demand.
  if (!isPasteId(id))
    return withStatus(request, headers, csp, 404, "Not Found");

  const { verdict, expiresAt } = await pasteLiveness(id);

  // PPR is why both of these need the proxy rather than the page. The route has a static
  // shell, so Next answers with the shell's own 200 (`x-nextjs-prerender: 1`) and streams
  // the dynamic part in — which means `notFound()` renders the right UI under the wrong
  // status, and the correct status can only be set before rendering starts.
  if (verdict === "gone") {
    return withStatus(request, headers, csp, 410, "Gone");
  }
  if (verdict === "unknown") {
    return withStatus(request, headers, csp, 404, "Not Found");
  }

  // Live. Bound the cache window by the remaining TTL: a paste with four seconds left
  // must not be served with `max-age=60`, or a cache answers with content for 56 seconds
  // after the paste stopped existing. Next's default for a dynamic page is `no-store`,
  // which is safe but throws away every bit of cacheability on the hot path.
  const response = passThrough();
  response.headers.set("cache-control", liveCacheControl({ expiresAt }));
  return response;
}

/**
 * Render the page as normal, then replace the status line.
 *
 * The page keeps producing the designed screen from the real row inside the real layout;
 * this changes nothing about the body. `redirect: "manual"` so a redirect the page issues
 * is relayed rather than followed.
 */
async function withStatus(
  request: NextRequest,
  headers: Headers,
  csp: string,
  status: number,
  statusText: string,
): Promise<NextResponse> {
  const inner = new Headers(headers);
  inner.set(INTERNAL, "1");

  // Where this fetch is allowed to go, pinned rather than inferred.
  //
  // `request.nextUrl`'s host ultimately derives from the Host header. Next normalises it,
  // and a forged `Host:` was measured not to redirect this fetch — but that is the
  // runtime's guarantee, not this code's, and the code as written would follow a foreign
  // origin if one ever reached it. Fetching an attacker-chosen origin and returning its
  // body under this app's domain is server-side request forgery plus content injection,
  // which is too severe to leave resting on a framework detail.
  //
  // So: set `PASTE_ORIGIN` in deployment and the destination is fixed. Unset, it falls
  // back to the resolved origin with an explicit same-origin check — which is what the
  // development server relies on.
  const pinned = process.env.PASTE_ORIGIN;
  const target = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    pinned ?? request.nextUrl.origin,
  );

  if (
    (pinned !== undefined && target.origin !== new URL(pinned).origin) ||
    !["http:", "https:"].includes(target.protocol) ||
    target.username !== "" ||
    target.password !== ""
  ) {
    // Fail closed to the correct content under a 200 rather than fetch somewhere unknown.
    const refused = NextResponse.next({ request: { headers } });
    refused.headers.set("content-security-policy", csp);
    return refused;
  }

  let rendered: Response;
  try {
    rendered = await fetch(target, {
      headers: inner,
      redirect: "manual",
    });
  } catch {
    // The status matters less than the page. If the self-fetch fails, let the reader have
    // the correct content under a 200 rather than an error page.
    const fallback = NextResponse.next({ request: { headers } });
    fallback.headers.set("content-security-policy", csp);
    return fallback;
  }

  const response = new NextResponse(rendered.body, {
    status,
    statusText,
    headers: rendered.headers,
  });

  response.headers.set("content-security-policy", csp);
  // A moderator can un-expire inside the grace window (§6.4), so a cached 410 would
  // outlive the decision that reversed it. A 404 is cached by some intermediaries by
  // default, and an id can start existing.
  response.headers.set("cache-control", noCache());
  // These describe the inner request's prerender, not this response, and leaving them on
  // tells a CDN it may reuse a status it should not.
  response.headers.delete("x-nextjs-prerender");
  response.headers.delete("x-nextjs-postponed");
  response.headers.delete("x-nextjs-stale-time");

  return response;
}
