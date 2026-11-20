import { NextResponse, type NextRequest } from "next/server";

import { auth, clerkClient } from "@clerk/nextjs/server";

import { sameOrigin } from "@/lib/http/same-origin";

// POST /sign-out — the other half of the header's account slot.
//
// WHY THIS IS NOT CLERK'S `<SignOutButton>`. That is a client component, and `AppShell`
// renders on EVERY route — so importing it would put `clerk.browser.js` on `/p/:id`, a
// remote third-party script on the page whose entire job is rendering attacker-supplied
// text. §6.5 exists to prevent exactly that, and `view-page-budget.spec.ts` would fail the
// build: N11 budgets one client module on that route and `body-tools.tsx` already spends it.
// `app-shell.tsx` has said since M10 that "signing out is a link to Clerk's own page"; this
// is that promise, kept on our own origin instead.
//
// A ROUTE, NOT A SERVER ACTION, following the precedent `p/[id]/fork/route.ts` sets. A route
// is referenced by URL, so the header needs no import and nothing lands in any page's module
// graph. It also means sign-out works with no client JavaScript at all.
//
// POST, NEVER GET, and this is the trap worth naming. A sign-out link that is a GET is
// triggered by anything that follows links: Next prefetches `<Link>` on hover, so a
// `<Link href="/sign-out">` in a header would sign a reader out for moving their mouse
// across the nav. Browsers and scanners prefetch too. Only a form POST is safe, and the
// absence of a GET export is what makes the framework answer 405 to one.

/** Cookie name prefixes Clerk owns. Everything matching is cleared on the way out. */
const CLERK_COOKIE_PREFIXES = [
  "__session",
  "__client_uat",
  "__clerk",
  "__refresh",
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    // 403 AND NOT a redirect, as on the fork route. A redirect would be followed by the
    // attacker's page and tell them what happened, and there is nothing to show a victim
    // because no browser of theirs asked for this.
    return new NextResponse(null, { status: 403, statusText: "Forbidden" });
  }

  // REVOKE FIRST, THEN CLEAR. The two steps do different jobs and only together add up to
  // "signed out".
  //
  // Clearing the cookies alone logs this browser out and leaves the session alive on
  // Clerk's side, so a copy of the cookie taken beforehand still works — which is the one
  // thing a sign-out button must not permit.
  //
  // Revoking alone is authoritative but not immediate: Clerk's `__session` is a short-lived
  // JWT that this app validates locally, so a revoked session keeps being accepted until
  // that token expires. Someone who clicks "sign out" and stays signed in for another
  // minute is entitled to call that broken.
  const { sessionId } = await auth();

  if (sessionId !== null && sessionId !== undefined) {
    try {
      await (await clerkClient()).sessions.revokeSession(sessionId);
    } catch (error) {
      // NOT FATAL, and the order is why. The cookies are cleared below regardless, so a
      // Clerk outage still ends the session in this browser rather than trapping someone
      // signed in with a button that answers 500. Logged because the session outliving the
      // click is a real if narrow exposure, and nothing else would record it.
      console.error("sign-out: revoking the session failed", error);
    }
  }

  const response = seeOther("/");

  // MATCHED BY PREFIX RATHER THAN LISTED. `__session` and `__client_uat` are Clerk's
  // documented names and `__clerk_db_jwt` is the development-instance one, but a hardcoded
  // list silently stops clearing a cookie the day Clerk adds or renames one — and the
  // failure mode is a sign-out that looks like it worked. Reading the names off the request
  // means we clear whatever this instance actually set.
  for (const cookie of request.cookies.getAll()) {
    if (CLERK_COOKIE_PREFIXES.some((p) => cookie.name.startsWith(p))) {
      response.cookies.delete(cookie.name);
    }
  }

  return response;
}

/**
 * 303 with a RELATIVE Location, for the same two reasons the fork route gives.
 *
 * 303 AND NOT 307: this answers a form POST, and 307 preserves the method — so a refresh
 * would re-POST. 303 tells the browser to follow with GET, which makes the landing page
 * reloadable.
 *
 * RELATIVE AND NOT ABSOLUTE: `NextResponse.redirect` needs an absolute URL, which means
 * deriving an origin from the `Host` header. A forged `Host:` would make this an open
 * redirect from this app's own domain, and on a sign-out route that is a phishing primitive:
 * "you have been signed out, sign in again" on someone else's page.
 */
function seeOther(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location } });
}
