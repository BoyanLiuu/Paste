import { beforeEach, describe, expect, it, vi } from "vitest";

// Session resolution, with Clerk mocked.
//
// Clerk's server module pulls Next's app-router React context, which does not exist under
// the `react-server` condition this suite resolves with — so the only way to test session
// resolution outside a real request is to replace Clerk at the boundary. What is being
// tested is this project's logic: the signed-out answer, and the username it mints and
// then freezes.

const authMock = vi.fn();
const currentUserMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

// `next/headers` TOO, SINCE M15. `getViewer` now falls back to a guest cookie when there is
// no Clerk session, so it reads `cookies()` — which throws "called outside a request scope"
// in this environment and failed three tests that had nothing to do with guests. Mocked at
// the same boundary and for the same reason as Clerk: what is under test is this project's
// resolution order, not Next's request plumbing.
const guestCookieMock = vi.fn<() => string | undefined>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "paste_guest" && guestCookieMock() !== undefined
        ? { name, value: guestCookieMock()! }
        : undefined,
  }),
}));

const { getViewer, usernameFrom } = await import("@/lib/server/session");

beforeEach(() => {
  authMock.mockReset();
  currentUserMock.mockReset();
  guestCookieMock.mockReset();
  // No guest cookie unless a test sets one, which is the common case.
  guestCookieMock.mockReturnValue(undefined);
});

describe("getViewer", () => {
  it("is anon with no session AND no guest cookie", async () => {
    authMock.mockResolvedValue({ userId: null });

    // Reads are public (§3). This arm has existed since M1 — it was never retrofitted —
    // because the view page must render for a signed-out visitor.
    //
    // THE CONDITION GAINED A SECOND HALF AT M15. "No session" used to mean anon on its own;
    // it now means anon only when there is also no guest cookie, because a guest resolves
    // to a real `users` row. The test's old name — "which is the product's premise" —
    // asserted the narrower claim, and renaming it is part of the change rather than
    // tidying: the premise is that READING is public, not that a signed-out visitor has no
    // identity at all.
    await expect(getViewer()).resolves.toEqual({ kind: "anon" });
  });

  it("resolves a guest from the cookie when Clerk has no session", async () => {
    authMock.mockResolvedValue({ userId: null });
    guestCookieMock.mockReturnValue("a-token-that-matches-no-row");

    // A token matching no row must fall back to anon rather than throw: the cookie outlives
    // the token once M16's claim clears it, and a stale cookie must not break the
    // create page. Exercised here with a token that cannot match, because a hit needs a
    // database and `guest.spec.ts` covers that.
    await expect(getViewer()).resolves.toEqual({ kind: "anon" });
  });

  it("prefers a Clerk session over a guest cookie", async () => {
    // THE ORDER MATTERS AND IS EASY TO GET BACKWARDS. A signed-in person with a leftover
    // guest cookie must resolve to their account, not to the guest — otherwise signing in
    // appears to do nothing, and anything they create lands on a row that M16 would later
    // try to claim into the account it already belongs to.
    authMock.mockResolvedValue({ userId: "user_clerk123" });
    guestCookieMock.mockReturnValue("a-stale-guest-token");

    const viewer = await getViewer();
    expect(viewer.kind).toBe("user");
    // Not the guest handle: `mintGuest` is the only writer of that shape.
    if (viewer.kind === "user") {
      expect(viewer.user.username.startsWith("guest-")).toBe(false);
    }
  });

  it("returns a promise, which is what let M10 replace the body in place", async () => {
    authMock.mockResolvedValue({ userId: null });
    const returned = getViewer();
    expect(returned).toBeInstanceOf(Promise);
    await returned;
  });

  it("does not ask Clerk for a user profile when nobody is signed in", async () => {
    authMock.mockResolvedValue({ userId: null });
    await getViewer();

    // `currentUser()` is a Backend API call. Making it on every anonymous page view would
    // put a network round trip on the hot path for the majority of readers, who are
    // signed out.
    expect(currentUserMock).not.toHaveBeenCalled();
  });
});

describe("usernameFrom", () => {
  it("builds a handle that is safe in a URL", () => {
    // The handle goes in `/list/:username`, a URL that must not rot — so it is slugified
    // once at sign-up and frozen, never re-derived from Clerk (§2).
    expect(usernameFrom("Alex.Smith@example.com")).toBe("alex-smith");
    expect(usernameFrom("someone")).toBe("someone");
    expect(usernameFrom("A B  C")).toBe("a-b-c");
  });

  it("never returns an empty handle", () => {
    // `/list/` with a blank segment is a different route, and would 404 in a way that
    // looks like the account is broken rather than like the handle is.
    expect(usernameFrom("!!!")).toBe("user");
    expect(usernameFrom("@example.com")).toBe("user");
    expect(usernameFrom("")).toBe("user");
  });

  it("strips anything that is not url-safe, and bounds the length", () => {
    expect(usernameFrom("../../etc/passwd")).toMatch(/^[a-z0-9-]+$/);
    expect(usernameFrom("a".repeat(100)).length).toBeLessThanOrEqual(32);
    expect(usernameFrom("-leading-and-trailing-")).toBe("leading-and-trailing");
  });
});
