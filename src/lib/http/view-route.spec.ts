// @vitest-environment node

// The three answers, and the forgeable-receipt bug (ARCHITECTURE §6.3).
//
//   200  the paste is live
//   410  it existed and is gone on purpose
//   404  no paste has ever had this id
//
// The 404/410 distinction is the one worth testing. A 404 for a lapsed paste breaks every
// document that cites the link — the reader cannot tell a dead link from a typo, which is
// the exact problem the permanent identifier exists to solve. A 410 for an id that never
// existed is worse in a quieter way: anyone could mint a plausible-looking receipt for a
// paste that never was, by inventing an id and screenshotting the tombstone.
//
// Tested here, on the proxy, because the proxy is where the status is decided. Next gives
// a page no way to set one: `notFound()` is the only status API, and the route is
// partially prerendered so the shell answers with its own 200 before the dynamic part
// resolves. `proxy.ts` explains the two approaches that failed.
//
// Lives beside `view-route.ts` rather than beside `proxy.ts`, and that split is load
// bearing: `proxy.ts` imports `clerkMiddleware`, which pulls React's client context into
// anything that imports it, and these tests run in a node environment where
// `React.createContext` does not exist. Separating the route logic from the middleware
// composition means the status decision can be tested without constructing a Clerk
// session to do it.

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { clearLivenessMemo } from "@/lib/server/liveness-probe";

const reason = skipReason();

/**
 * Run the proxy against one path, with its self-fetch stubbed.
 *
 * The real proxy fetches the page to get its HTML and then re-wraps it with the right
 * status. That self-fetch needs a running server, which a unit test has no business
 * starting — so it is stubbed, and what is asserted is the status the proxy chose. The
 * body is the page's, unchanged, which is the point of the design.
 */
async function statusFor(path: string): Promise<number> {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("<html>page</html>", { status: 200 }));

  try {
    const { viewRoute } = await import("@/lib/http/view-route");
    const response = await viewRoute(
      new NextRequest(`http://localhost:3025${path}`),
    );
    return response.status;
  } finally {
    fetchSpy.mockRestore();
  }
}

describe.skipIf(reason !== null)(
  `the view route's status${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("answers 404 for an id that never existed, not a tombstone", async () => {
      clearLivenessMemo();
      // The forgeable receipt. `zzzzzzzz` is a well-formed id — every character is in the
      // base58 alphabet — so this cannot pass by being rejected on shape.
      expect(await statusFor("/p/zzzzzzzz")).toBe(404);
    });

    it("answers 404 for a string that is not shaped like an id", async () => {
      clearLivenessMemo();
      // Refused without a database round trip. Also the guard on the proxy's memo: ids
      // are attacker-supplied, so an unbounded key space is a way to make a long-lived
      // server process allocate on demand.
      for (const bad of ["not-an-id", "short", "0bcdefgh", "toolongforanid"]) {
        expect(await statusFor(`/p/${bad}`), bad).toBe(404);
      }
    });

    it("answers 410 for a lapsed paste whose state still says live", async () => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        // The sweeper has not run. A 404 here is the failure the plan's demo names.
        const [id] = await seedPastes(owner.userId, [
          { expiresInMinutes: -1, state: "live" },
        ]);
        expect(await statusFor(`/p/${id}`)).toBe(410);
      });
    });

    it("answers 410 for a purged paste", async () => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        const [id] = await seedPastes(owner.userId, [
          { expiresInMinutes: -60, state: "purged" },
        ]);
        expect(await statusFor(`/p/${id}`)).toBe(410);
      });
    });

    it("answers 200 for a live paste", async () => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        const [id] = await seedPastes(owner.userId, [{ expiresInMinutes: 60 }]);
        expect(await statusFor(`/p/${id}`)).toBe(200);
      });
    });

    it("does not recurse when it sees its own internal fetch", async () => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        const [id] = await seedPastes(owner.userId, [
          { expiresInMinutes: -1, state: "live" },
        ]);

        const fetchSpy = vi.spyOn(globalThis, "fetch");
        try {
          const { viewRoute } = await import("@/lib/http/view-route");
          // The inner half of the self-fetch. Without the marker header the proxy would
          // call itself forever, each call doing another database lookup.
          const response = await viewRoute(
            new NextRequest(`http://localhost:3025/p/${id}`, {
              headers: { "x-paste-internal": "1" },
            }),
          );

          expect(response.status).toBe(200);
          expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
          fetchSpy.mockRestore();
        }
      });
    });

    it("does not follow a foreign origin when PASTE_ORIGIN pins the destination", async () => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        const [id] = await seedPastes(owner.userId, [
          { expiresInMinutes: -1, state: "live" },
        ]);

        // The self-fetch's destination derives from the Host header. Next normalises it
        // and a forged `Host:` was measured not to redirect the fetch — but that is the
        // framework's guarantee, not this code's. Fetching an attacker-chosen origin and
        // returning its body under this app's domain is server-side request forgery plus
        // content injection, so `PASTE_ORIGIN` pins it and this asserts the pin holds.
        const previous = process.env.PASTE_ORIGIN;
        process.env.PASTE_ORIGIN = "http://localhost:3025";
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(
            new Response("<html>page</html>", { status: 200 }),
          );

        try {
          const { viewRoute } = await import("@/lib/http/view-route");
          await viewRoute(new NextRequest(`http://evil.example/p/${id}`));

          if (fetchSpy.mock.calls.length > 0) {
            const target = String(
              (fetchSpy.mock.calls[0][0] as URL | string) ?? "",
            );
            expect(target).not.toContain("evil.example");
            expect(target).toContain("localhost:3025");
          }
        } finally {
          fetchSpy.mockRestore();
          if (previous === undefined) delete process.env.PASTE_ORIGIN;
          else process.env.PASTE_ORIGIN = previous;
        }
      });
    });

    it("sets a CSP with a per-request nonce on every answer", async () => {
      await withTestOwner(async (owner) => {
        clearLivenessMemo();
        const [id] = await seedPastes(owner.userId, [{ expiresInMinutes: 60 }]);

        const { viewRoute } = await import("@/lib/http/view-route");
        const nonces = new Set<string>();
        for (let i = 0; i < 3; i += 1) {
          const response = await viewRoute(
            new NextRequest(`http://localhost:3025/p/${id}`),
          );
          const csp = response.headers.get("content-security-policy");
          expect(csp).toContain("script-src 'self' 'nonce-");
          nonces.add(csp!.match(/'nonce-([^']+)'/)![1]);
        }

        // A reused nonce is not a nonce: it lets an injected script carry a value that
        // was valid on a previous response (§6.5).
        expect(nonces.size).toBe(3);
      });
    });
  },
);
