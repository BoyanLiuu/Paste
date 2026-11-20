import type { NextRequest } from "next/server";

// The CSRF check every POST route handler in this app needs.
//
// EXTRACTED FROM `p/[id]/fork/route.ts` when sign-out became the second such route. Next
// checks the `Origin` of a Server Action automatically; a route handler gets no such check,
// so every route we move off an action — to keep a module out of the view page's graph, in
// fork's case — has to bring its own. Two copies of a security check is two chances for one
// of them to be fixed and the other not, which is the mistake `tests/e2e/fixture.ts` records
// having made twice with a teardown.
//
// WHAT THIS DEFENDS. Without it, any page anywhere can POST a form at one of these URLs and
// the victim's browser attaches their session cookie — so a third party decides what pastes
// they create, or signs them out of this site at a moment of someone else's choosing.
// Measured on the fork route before the check existed: a POST carrying
// `Origin: https://evil.example` was answered 303.

/**
 * Whether a browser on this site sent this, as opposed to a page somewhere else.
 *
 * `Origin` is set by the browser on every cross-site form POST and cannot be forged by the
 * page making the request — which is the whole basis of the check. Compared against
 * `PASTE_ORIGIN` when deployment pins it, and otherwise against the request's own host.
 *
 * A REQUEST WITH NO ORIGIN IS ALLOWED, deliberately. `curl` sends none, and it also carries
 * no ambient session cookie, so it is not the threat — the threat is a victim's browser
 * acting on someone else's instruction, and that browser always sends the header. Refusing
 * header-less requests would break every non-browser caller to stop nobody.
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;

  const pinned = process.env.PASTE_ORIGIN;
  if (pinned !== undefined) {
    try {
      return new URL(origin).origin === new URL(pinned).origin;
    } catch {
      return false;
    }
  }

  // No pin: compare hosts. A forged `Host:` defeats this, and a forged Host means the
  // caller is not a victim's browser — which is the only thing this check is about.
  const host = request.headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}
