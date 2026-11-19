import { clerkMiddleware } from "@clerk/nextjs/server";

import { viewRoute } from "@/lib/http/view-route";

// The single middleware file Next allows, and therefore a composition root rather than a
// place where behaviour lives.
//
// `clerk init` SKIPPED this file — "existing middleware uses an unsupported shape for
// automatic Clerk composition" — which was the right call: it left the 410/404 status
// logic and the per-request CSP nonce intact. Composing by hand was the only option
// anyway, because Next allows exactly one middleware file and `clerkMiddleware` cannot be
// a second one.
//
// The route behaviour is `@/lib/http/view-route`, which this wraps. It lives there and not
// here for a concrete reason: importing `@clerk/nextjs/server` pulls React's client
// context into whatever imports it, and the status logic's tests run in a node environment
// where `React.createContext` does not exist. Separating them means those tests exercise
// the status decision without constructing a Clerk session to do it.
//
// NAMED proxy.ts, NOT middleware.ts. Next 16 deprecates the old convention, and the two
// differ in the way that decides whether any of this is possible: `middleware.ts` compiles
// for the Edge runtime — the build warns on every `node:` import — while `proxy.ts`
// defaults to Node and can reach Postgres, which the 410 needs.
//
// THE MATCHER IS BROAD, because `auth()` has no session context on a route this does not
// run on, and the create form, the list page and the view page all resolve a viewer.
// Static assets and `_next` are excluded: running auth on a font is pure latency.
//
// A NOTE ON THE PLAN. It specifies a public-route allowlist here — `/p/(.*)`, `/raw/(.*)`
// and friends marked public — and warns that a careless matcher protects the view page and
// breaks the product's premise. Clerk 7 inverts that default: routes are public unless
// something calls `auth.protect()`, so there is no allowlist to get wrong. Protection
// lives where it belongs instead, in `assertCan` inside every mutation, which
// `capability-denial.spec.ts` exercises by calling the mutations directly rather than by
// trusting a matcher.

export const config = {
  matcher: [
    // Everything except Next's internals and files with an extension. Clerk's recommended
    // shape; the negative lookahead is what keeps auth off static assets.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

export default clerkMiddleware(async (_auth, request) => {
  // Returning a response ends the request; returning `next()` continues it. Clerk has
  // attached the session by this point, so `auth()` works in whatever renders.
  return viewRoute(request);
});
