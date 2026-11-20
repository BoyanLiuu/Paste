// @vitest-environment node

// POST /sign-out (ARCHITECTURE §3, §6.5).
//
// Three things here can be wrong while the button appears to work, and each gets a test.
//
// 1. A GET handler. Next prefetches `<Link>` on hover and browsers prefetch too, so a
//    sign-out reachable by GET signs people out for moving the mouse across the nav. The
//    absence of the export is what makes the framework answer 405, so the absence is
//    asserted — there is no way to observe "nobody added a GET" from the outside.
// 2. Clearing the cookies without revoking the session. The browser looks signed out and a
//    copy of the cookie taken beforehand still works, which is the one thing a sign-out
//    must not permit.
// 3. Revoking without clearing. Clerk's `__session` is a short-lived JWT validated locally,
//    so the click appears to do nothing for up to its lifetime.
//
// The cookie clearing is asserted through a name the implementation cannot have hardcoded,
// because a hardcoded list is the failure that would survive a test using Clerk's current
// names.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** What `auth()` reports. Mutated per test. */
let sessionId: string | null = "sess_abc123";

/** Every session id `revokeSession` was called with, in order. */
const revoked: string[] = [];

/** Set to make the Clerk call fail, for the outage case. */
let revokeThrows = false;

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ sessionId }),
  clerkClient: async () => ({
    sessions: {
      revokeSession: async (id: string) => {
        revoked.push(id);
        if (revokeThrows) throw new Error("clerk is down");
      },
    },
  }),
}));

const { POST, ...handlers } = await import("@/app/sign-out/route");

/** A browser-shaped POST from this site, optionally carrying cookies. */
function post(options: { origin?: string | null; cookies?: string } = {}) {
  const headers = new Headers({ host: "paste.test" });
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "https://paste.test");
  }
  if (options.cookies !== undefined) headers.set("cookie", options.cookies);

  return POST(
    new NextRequest("https://paste.test/sign-out", { method: "POST", headers }),
  );
}

/** The names this response tells the browser to drop, read off Set-Cookie. */
function cleared(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .filter((c) => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c))
    .map((c) => c.split("=")[0].trim())
    .sort();
}

beforeEach(() => {
  sessionId = "sess_abc123";
  revoked.length = 0;
  revokeThrows = false;
  delete process.env.PASTE_ORIGIN;
});

describe("POST /sign-out", () => {
  it("exports no GET, so a prefetch cannot sign anyone out", () => {
    // THE WHOLE POINT OF THE ROUTE BEING A FORM. `<Link href="/sign-out">` would be
    // prefetched on hover; if a GET handler ever appears here, that prefetch becomes a
    // sign-out nobody asked for. Checked as the shape of the module because the defence IS
    // the missing export.
    expect(Object.keys(handlers)).not.toContain("GET");
    expect(Object.keys(handlers)).toEqual([]);
  });

  it("revokes the session server-side, not just in this browser", async () => {
    await post();
    expect(revoked).toEqual(["sess_abc123"]);
  });

  it("clears every Clerk cookie the request carried, including one not hardcoded", async () => {
    // `__clerk_invented_later` is the assertion that matters: it is not a name Clerk uses
    // today, so it can only be cleared by matching the prefix off the request. A listed
    // set of names would pass the other two and silently stop clearing the day Clerk
    // renames something.
    const response = await post({
      cookies:
        "__session=jwt; __client_uat=1763000000; __clerk_db_jwt=dev; __clerk_invented_later=x; theme=dark",
    });

    expect(cleared(response)).toEqual([
      "__clerk_db_jwt",
      "__clerk_invented_later",
      "__client_uat",
      "__session",
    ]);
  });

  it("leaves cookies that are not Clerk's alone", async () => {
    // A sign-out that wipes unrelated state is a different bug with the same cause.
    const response = await post({ cookies: "theme=dark; __sessionish=keep" });
    expect(cleared(response)).not.toContain("theme");
  });

  it("clears the cookies even when revoking fails", async () => {
    // A Clerk outage must not trap someone signed in behind a button that answers 500.
    // The session outliving the click is logged; this browser's is still ended.
    revokeThrows = true;
    const response = await post({ cookies: "__session=jwt" });

    expect(response.status).toBe(303);
    expect(cleared(response)).toEqual(["__session"]);
  });

  it("redirects 303 to a relative location", async () => {
    // 303 so a refresh does not re-POST. Relative so a forged `Host:` cannot turn this
    // into an open redirect from our own domain — on a sign-out route that is a phishing
    // primitive: "you have been signed out, sign in again".
    const response = await post();

    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBe("/");
    expect(location?.startsWith("http")).toBe(false);
  });

  it("refuses a cross-origin POST with 403 and revokes nothing", async () => {
    // Logout CSRF. Low harm next to fork's, and free to prevent given the check exists.
    const response = await post({ origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(revoked).toEqual([]);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows a request with no Origin, which is not a browser", async () => {
    // `curl` sends no Origin and carries no ambient cookie, so it is not the threat.
    // Refusing header-less requests would break non-browser callers to stop nobody.
    const response = await post({ origin: null });
    expect(response.status).toBe(303);
  });

  it("works when nobody is signed in", async () => {
    // Reachable: two tabs, sign out in one, press the stale button in the other. It has to
    // land on the home page rather than throw on a null session id.
    sessionId = null;
    const response = await post();

    expect(response.status).toBe(303);
    expect(revoked).toEqual([]);
  });
});
