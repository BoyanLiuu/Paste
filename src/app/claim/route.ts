import { NextResponse, type NextRequest } from "next/server";

import { cookies } from "next/headers";

import { isGuestUsername } from "@/lib/guest-handle";
import { sameOrigin } from "@/lib/http/same-origin";
import { GUEST_COOKIE, claimGuestPastes } from "@/lib/server/guest";
import { getViewer } from "@/lib/server/session";
import { userIdFor } from "@/lib/server/users";

// POST /claim — move a guest's pastes into the account that just signed in (M16).
//
// WHY THIS EXISTS AS A DECISION RATHER THAN A HOOK. The obvious implementation is to claim
// silently inside `createLocalUser`, which already runs exactly once on first sign-in. Two
// things rule that out:
//
//   1. It only covers FIRST sign-in. Someone with an existing account who pastes something
//      anonymously and then signs in would never be offered their paste back — which is the
//      case the user reported, and the common one.
//   2. One browser can be two people. A shared laptop, a borrowed machine: a silent merge
//      hands person B's pastes to person A permanently, and nothing is editable or
//      deletable afterwards (§6.3). Asking is not politeness, it is the only safe default.
//
// So the claim is a button. `ClaimBanner` in `app-shell.tsx` offers it whenever a signed-in
// account arrives carrying a guest cookie, and declining clears the cookie so the question
// is asked once.
//
// POST, NEVER GET, for the reason `/sign-out` gives at greater length: Next prefetches
// `<Link>` on hover, so a GET would claim someone else's pastes because a mouse crossed the
// nav. The absence of a GET export is what makes the framework answer 405.

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return new NextResponse(null, { status: 403, statusText: "Forbidden" });
  }

  const jar = await cookies();
  const token = jar.get(GUEST_COOKIE)?.value;

  // DECLINING IS A REAL OUTCOME, and it has to clear the cookie. Left in place, the banner
  // returns on every page for the rest of the cookie's month — and the person who meant
  // "these are not mine" would be asked to adopt them again on every navigation.
  const declined = new URL(request.url).searchParams.get("decline") === "1";

  const viewer = await getViewer();
  const signedIn =
    viewer.kind === "user" && !isGuestUsername(viewer.user.username);

  if (token === undefined || token === "" || !signedIn || declined) {
    const response = seeOther(declined ? "/new" : "/");
    if (token !== undefined) response.cookies.delete(GUEST_COOKIE);
    return response;
  }

  const accountUserId = await userIdFor(viewer);
  const moved = await claimGuestPastes(accountUserId, token);

  // THE COOKIE GOES WHETHER OR NOT ANYTHING MOVED. Zero is an ordinary outcome — the guest
  // row was already claimed, or the cookie outlived it — and in every one of those cases the
  // cookie is spent. Keeping it would mean re-asking forever about pastes that do not exist.
  const response = seeOther(
    moved > 0 ? `/list/${viewer.user.username}` : "/new",
  );
  response.cookies.delete(GUEST_COOKIE);
  return response;
}

/**
 * 303 with a RELATIVE Location, as `/sign-out` and the fork route both do.
 *
 * 303 so a refresh does not re-POST, which here would be harmless only because the claim is
 * idempotent — and relying on that is how the next non-idempotent thing gets a 307.
 * Relative because deriving an origin from `Host` makes this an open redirect, and on a
 * route reached straight after signing in that is a phishing primitive.
 */
function seeOther(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location } });
}
