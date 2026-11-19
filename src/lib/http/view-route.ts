import { NextResponse, type NextRequest } from "next/server";

import { liveCacheControl, noCache } from "@/lib/http/cache";
import { isPasteId } from "@/lib/ids";
import { clerkCsp, viewCsp } from "@/lib/http/csp";
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

//

// Marking the proxy's own internal fetch, so it does not recurse into itself.
//
// THE VALUE WAS THE LITERAL "1", which any client can send — and that was not a cosmetic
// weakness. One forged header skipped every decision this file makes: `/moderation`
// answered 200 with "Removal requests" in the title, undoing the gate below, and a gone
// paste answered 200 instead of 410. Measured on the built server, not reasoned about.
//
// Two changes, because neither is sufficient alone:
//
//   TOKEN   the marker is a secret, so forging it is guesswork. From the environment when
//           set, so every instance of a horizontally scaled deployment agrees; otherwise
//           per-process, which is right for one server and for the test suite.
//   HOPS    a plain counter, and the reason the token is safe to rely on. If the self-fetch
//           lands on an instance whose token differs — a rolling deploy, or an unset
//           variable behind a load balancer — the inner request looks external, and without
//           a cap it would fetch itself again from there. Unbounded fan-out across
//           instances is a worse failure than the leak this fixes, so the hop count stops
//           it at one regardless of whether the token matched.
//
// A client can still forge the hop count and get its OWN request answered 200 instead of
// 410. That residue is deliberate: the body is still the tombstone the page computed, so a
// forger misleads nobody but themselves, and the alternative is a recursion risk in
// production. Set `PASTE_INTERNAL_TOKEN` in deployment and even that closes.
const INTERNAL = "x-paste-internal";
const HOPS = "x-paste-hops";
const TOKEN = process.env.PASTE_INTERNAL_TOKEN ?? crypto.randomUUID();

/**
 * A path with no route behind it, rendered to produce the generic not-found body.
 *
 * Used by the /moderation gate so a refusal is byte-identical to any unknown URL. Rendering
 * /moderation itself and re-labelling it 404 was not enough: the page's static `metadata`
 * puts `<title>Removal requests — Paste</title>` in the shell, so the correct status
 * arrived carrying the disclosure it was meant to prevent.
 *
 * `_paste` is reserved rather than arbitrary — if a route ever claims it, the gate starts
 * serving that route's body, which `view-route.spec.ts` asserts against.
 */
const NOT_FOUND_PATH = "/_paste/not-found";

export async function viewRoute(
  request: NextRequest,
  clerkUserId: string | null = null,
): Promise<NextResponse> {
  const path = request.nextUrl.pathname;

  // Whether this is the proxy talking to itself. Two signals, and `view-route.ts`'s header
  // comment explains why it takes both.
  const internal =
    request.headers.get(INTERNAL) === TOKEN ||
    Number(request.headers.get(HOPS) ?? "0") >= 1;

  // THE GATE RUNS EVEN ON AN APPARENTLY INTERNAL REQUEST, which is the fix for the forged
  // header. It can sit above the self-fetch guard because its own `withStatus` call renders
  // NOT_FOUND_PATH — a path this branch does not match — so the inner request cannot come
  // back here. That is also what made the first version recurse: it fetched /moderation.
  //
  // /moderation answers 404 to anyone who does not moderate.
  //
  // 404 AND NOT 403: a 403 confirms the page exists, which tells a prober this
  // installation has a moderation surface and that they are not on it. `notFound()` in the
  // page renders the right body but cannot set the status — the route has a static shell,
  // so Next answers with the shell's own 200 and a prober sees 200 here against 404 for
  // any genuinely missing route. The page's own comment claimed 404 and was wrong until
  // this branch existed.
  if (path === "/moderation" || path.startsWith("/moderation/")) {
    const { moderatesByClerkId } = await import("@/lib/server/liveness-probe");
    if (!(await moderatesByClerkId(clerkUserId))) {
      const headers = new Headers(request.headers);
      return withStatus(request, headers, "", 404, "Not Found", NOT_FOUND_PATH);
    }
    return NextResponse.next();
  }

  if (internal) return NextResponse.next();

  if (!path.startsWith("/p/")) {
    if (
      path === "/sign-in" ||
      path.startsWith("/sign-in/") ||
      path === "/sign-up" ||
      path.startsWith("/sign-up/")
    ) {
      const response = NextResponse.next();
      // A real policy on the Clerk pages rather than none, which is what they had when the
      // matcher covered only /p/*. It permits Clerk's frontend API and nothing else —
      // §6.5's point is one strict policy per page, not one loose policy everywhere.
      response.headers.set("content-security-policy", clerkCsp());
      return response;
    }
    return NextResponse.next();
  }

  // REUSE THE INHERITED NONCE ON THE INTERNAL FETCH.
  //
  // `withStatus` renders the page by fetching it, then re-wraps that body with a new
  // status. The body's inline scripts are stamped with whatever nonce the INNER request
  // carried, and the outer response's CSP header has to match them.
  //
  // Generating a fresh nonce unconditionally broke exactly that: the outer call minted A
  // and fetched with `x-nonce: A`, the inner call overwrote it with B, Next stamped the
  // scripts with B, and the outer response then declared A. Every script on the page was
  // blocked — so the 410 tombstone rendered into React's hidden relocation div and stayed
  // there, invisible, under a correct status code. The same failure `csp.ts` describes,
  // reached from the opposite direction.
  const inherited = request.headers.get("x-nonce");
  const nonce =
    internal && inherited !== null ? inherited : crypto.randomUUID();
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

  // The inner half of the self-fetch below, with the inherited nonce attached. Without
  // this the proxy would call itself forever, each call doing another database lookup.
  if (internal) return passThrough();

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

/** `next()` with the nonce headers, for the paths that bail out of the status rewrite. */
function passThroughFor(
  _request: NextRequest,
  headers: Headers,
  csp: string,
): NextResponse {
  const response = NextResponse.next({ request: { headers } });
  if (csp !== "") response.headers.set("content-security-policy", csp);
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
  /** Render this path instead of the requested one. The /moderation gate's disclosure fix. */
  renderPath?: string,
): Promise<NextResponse> {
  const inner = new Headers(headers);
  inner.set(INTERNAL, TOKEN);
  inner.set(
    HOPS,
    String(Number(request.headers.get(HOPS) ?? "0") + 1),
  );

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

  // The base comes from `request.url`, which is always an absolute URL string.
  //
  // It was `request.nextUrl.origin`, and that broke the moment `clerkMiddleware` wrapped
  // this: under the wrapper the origin came back empty, so `new URL("/p/zzzzzzzz", "")`
  // threw `ERR_INVALID_URL` and every 404 and 410 became a 500. The pathname was fine,
  // which is why it looked like a URL-construction bug rather than a composition one.
  let base: string;
  try {
    base = pinned ?? new URL(request.url).origin;
  } catch {
    return passThroughFor(request, headers, csp);
  }

  const target = new URL(
    renderPath ?? request.nextUrl.pathname + request.nextUrl.search,
    base,
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
    return passThroughFor(request, headers, csp);
  }

  const response = new NextResponse(rendered.body, {
    status,
    statusText,
    headers: rendered.headers,
  });

  if (csp !== "") response.headers.set("content-security-policy", csp);
  // A moderator can un-expire inside the grace window (§6.4), so a cached 410 would
  // outlive the decision that reversed it. A 404 is cached by some intermediaries by
  // default, and an id can start existing.
  response.headers.set("cache-control", noCache());
  // Strip the framework's own internal headers off the copy.
  //
  // The inner response carries Next's middleware and prerender bookkeeping, and
  // re-emitting it is wrong twice over.
  //
  // `x-middleware-rewrite` holds a PATHNAME, and once `clerkMiddleware` wrapped this
  // route it post-processed the returned response and parsed that header as a URL —
  // `new URL("/p/zzzzzzzz")` with no base, so every 404 and 410 on /p/* became a
  // `TypeError: Invalid URL` 500. It worked for two milestones because nothing had ever
  // looked at the response after this function built it.
  //
  // The `x-nextjs-*` trio describes the inner request's prerender rather than this
  // response, and leaving them on tells a CDN it may reuse a status it should not.
  for (const header of [
    "x-middleware-rewrite",
    "x-middleware-next",
    "x-middleware-skip",
    "x-middleware-set-cookie",
    "x-nextjs-prerender",
    "x-nextjs-postponed",
    "x-nextjs-stale-time",
  ]) {
    response.headers.delete(header);
  }

  return response;
}
