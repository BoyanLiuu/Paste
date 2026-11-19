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

const { getViewer, usernameFrom } = await import("@/lib/server/session");

beforeEach(() => {
  authMock.mockReset();
  currentUserMock.mockReset();
});

describe("getViewer", () => {
  it("is anon with no session, which is the product's premise", async () => {
    authMock.mockResolvedValue({ userId: null });

    // Reads are public (§3). This arm has existed since M1 — it was never retrofitted —
    // because the view page must render for a signed-out visitor.
    await expect(getViewer()).resolves.toEqual({ kind: "anon" });
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
