import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_RETENTION } from "@/lib/expiry/retention";
import type { ForkProblem } from "@/lib/fork-problem";
import { BlockedBySecretScan, NeedsOverride } from "@/lib/server/create-errors";
import { NothingToFork } from "@/lib/server/fork";
import { forkPaste } from "@/lib/server/mutations";
import { getViewer } from "@/lib/server/session";
import { NotPermittedError } from "@/lib/server/viewer";

// POST /p/:id/fork — forking, as a route rather than a server action (ux-19, 25).
//
// A DEVIATION FROM §3, which lists `forkPaste` as a server action, and N11 is the reason.
// Anything that can call `forkPaste` transitively imports the create path, which imports
// the highlighter — so a server action imported by the view page puts Shiki in the view
// route's module graph. `view-route-imports.spec.ts` failed on exactly that trail, twice,
// once through the error classes and once through `forkPaste` itself. A dynamic import does
// not help: the guard walks those too, deliberately.
//
// A route is referenced by URL, so the view page's form needs no import at all and the hot
// path's graph stays clean. It also means forking works with no client JavaScript, on a
// page whose one client child exists to attach a selection listener.
//
// WHAT THIS DOES NOT DO is choose a retention. The designed affordance is a single Fork
// button, so the fork gets the default rather than inheriting the source's — the forker is
// the one who has to live with the expiry, and inheriting `never` from someone else's paste
// would hand them an obligation they never chose.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  // SAME-ORIGIN ONLY, and this is the cost of the deviation above rather than an extra.
  //
  // Next checks the Origin of a Server Action for exactly this reason; a route handler gets
  // no such check, so moving fork off an action to keep Shiki out of the view page's graph
  // silently dropped it. Without this, any page anywhere can POST a form at this URL and a
  // signed-in reader's browser attaches their session — so a third party decides what
  // pastes they create. Measured: a POST carrying `Origin: https://evil.example` was
  // answered 303.
  if (!sameOrigin(request)) {
    // 403 AND NOT a redirect. A redirect would be followed by the attacker's page and tell
    // them what happened; there is also nothing to show a victim, since no browser asked
    // for this.
    return new NextResponse(null, { status: 403, statusText: "Forbidden" });
  }

  let outcome: { ok: true; id: string } | { ok: false; why: ForkProblem };

  try {
    const viewer = await getViewer();
    const fork = await forkPaste(viewer, id, DEFAULT_RETENTION);
    outcome = { ok: true, id: fork.id };
  } catch (error) {
    outcome = { ok: false, why: problemFor(error) };
  }

  return seeOther(
    outcome.ok ? `/p/${outcome.id}` : `/p/${id}?fork=${outcome.why}`,
  );
}

/**
 * 303 with a RELATIVE Location, and both halves are deliberate.
 *
 * 303 AND NOT 307: this answers a form POST, and a 307 preserves the method — so the
 * browser would re-POST on a refresh and fork again. 303 tells it to follow with GET,
 * which is what makes the resulting page reloadable.
 *
 * RELATIVE AND NOT ABSOLUTE: `NextResponse.redirect` needs an absolute URL, which means
 * deriving an origin from the Host header — the same input `view-route.ts` had to pin with
 * `PASTE_ORIGIN` to stop its self-fetch wandering. A forged `Host:` there was server-side
 * request forgery; here it would be an open redirect from this app's own domain. A relative
 * Location is valid and takes the question off the table.
 *
 * `next/navigation`'s `redirect()` was the first implementation. It works by throwing, so
 * it has to sit outside the `try` or the catch swallows it and reports a successful fork as
 * a failure — and it imports React's client navigation context, which cannot load in the
 * node environment these tests run in. The same split that keeps `view-route.ts` separate
 * from `proxy.ts`.
 */
function seeOther(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location } });
}

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
function sameOrigin(request: NextRequest): boolean {
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

/**
 * The refusal, translated for a reader of the source paste.
 *
 * The blocked case is the interesting one and it is NOT a bug: §6.3's rule set grows, so a
 * paste accepted months ago can fail today's scan. The source stays readable, because
 * destroying it is a moderator's decision with its own queue — which means the banner has
 * to explain why the fork failed while the thing in front of them still works.
 */
function problemFor(error: unknown): ForkProblem {
  if (error instanceof BlockedBySecretScan) return "blocked";
  if (error instanceof NeedsOverride) return "override";
  if (error instanceof NothingToFork) return "gone";
  if (error instanceof NotPermittedError) return "signin";

  // Logged rather than shown: the message could carry a database detail, and the reader can
  // act on "it failed, nothing was created" and on nothing more specific.
  console.error("fork: unexpected failure", error);
  return "failed";
}
