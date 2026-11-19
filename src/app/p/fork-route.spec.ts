// @vitest-environment node

// The fork button's half of the laundering defence (ARCHITECTURE §6.3, ux-19, 25).
//
// `fork-rescan.spec.ts` asserts that forking a now-blocked body is REFUSED. This asserts
// the reader is told why — which is a separate failure with its own consequence.
//
// A refusal reported as "it didn't go through, try again" invites exactly the retry loop
// the refusal exists to stop, and leaves the reader believing the feature is broken while
// the source paste sits in front of them working perfectly. The explanation is the
// uncomfortable one: a fork is a new paste, scanned with today's rules, and the original is
// grandfathered because destroying it is a moderator's decision with its own queue.
//
// The route is tested rather than the mutation because the mapping from exception to
// message is the part that can be wrong while every other test passes.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ownedCounts,
  seedPastes,
  skipReason,
  slackTokenShape,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import type { Viewer } from "@/lib/types";

const reason = skipReason();

// The route resolves its own viewer, which is the behaviour under test — §3's rule is that
// the acting user comes from the session and never from a request argument. So the session
// is mocked and nothing else is.
let viewer: Viewer = { kind: "anon" };
vi.mock("@/lib/server/session", () => ({
  getViewer: async () => viewer,
}));

/** POST the route and read where it sent the reader. */
async function forkAndFollow(id: string): Promise<string> {
  const response = await post(id, {});

  // 303, because this answers a form POST: a 307 preserves the method, so a refresh would
  // fork again. Asserted on every path rather than once, since the status is the part that
  // decides whether the resulting page is reloadable.
  expect(response.status).toBe(303);
  return response.headers.get("location") ?? "";
}

/** POST with chosen headers, for the origin check. */
async function post(
  id: string,
  headers: Record<string, string>,
): Promise<Response> {
  const { POST } = await import("@/app/p/[id]/fork/route");
  const request = new NextRequest(`http://localhost:3025/p/${id}/fork`, {
    method: "POST",
    headers,
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

describe.skipIf(reason !== null)(
  `the fork route${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    beforeEach(() => {
      viewer = { kind: "anon" };
    });

    it("sends a signed-out visitor to sign in rather than reporting a failure", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [
          { body: "print('hi')\n" },
        ]);

        expect(await forkAndFollow(id)).toBe(`/p/${id}?fork=signin`);
      });
    });

    it("names the secret scan when the fork is blocked, not a generic failure", async () => {
      await withTestOwner(async (owner) => {
        const [sourceId] = await seedPastes(owner.userId, [
          { body: `SLACK_TOKEN = "${slackTokenShape()}"\n` },
        ]);

        await withTestOwner(async (forker) => {
          viewer = forker.viewer;

          // `blocked`, which the banner turns into an explanation. `failed` here would
          // read as "try again" — an invitation to retry a refusal that is never going to
          // succeed, on content the product has decided not to republish.
          expect(await forkAndFollow(sourceId)).toBe(
            `/p/${sourceId}?fork=blocked`,
          );

          // And nothing was written, so the refusal left no URL for the credential.
          expect((await ownedCounts(forker.userId)).pastes).toBe(0);
        });
      });
    });

    it("sends the forker to their new paste when the body is clean", async () => {
      await withTestOwner(async (owner) => {
        const [sourceId] = await seedPastes(owner.userId, [
          { body: "def retry(fn):\n    return fn()\n" },
        ]);

        await withTestOwner(async (forker) => {
          viewer = forker.viewer;

          const target = await forkAndFollow(sourceId);
          // A NEW id, not the source's. The fork is its own permanent reference, and
          // landing back on the original would hide whether anything happened.
          expect(target).toMatch(/^\/p\/[1-9A-HJ-NP-Za-km-z]{8}$/);
          expect(target).not.toBe(`/p/${sourceId}`);
          expect((await ownedCounts(forker.userId)).pastes).toBe(1);
        });
      });
    });

    it("refuses a POST from another origin before doing anything", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [
          { body: "print('hi')\n" },
        ]);

        await withTestOwner(async (forker) => {
          viewer = forker.viewer;

          // A form on someone else's page, submitted by a reader whose browser attaches
          // their session. Next checks this for a Server Action; a route handler does not,
          // so moving fork off an action to keep the highlighter out of the view page's
          // module graph dropped the check with it.
          const response = await post(id, {
            origin: "https://evil.example",
            host: "localhost:3025",
          });

          expect(response.status).toBe(403);
          // AND NOTHING WAS CREATED. A 403 that still forked would be the same bug with a
          // tidier status line.
          expect((await ownedCounts(forker.userId)).pastes).toBe(0);
        });
      });
    });

    it("accepts a POST from its own origin", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [
          { body: "print('hi')\n" },
        ]);

        await withTestOwner(async (forker) => {
          viewer = forker.viewer;

          // Guards the guard: a check that refused everything would pass the test above
          // and break the feature.
          const response = await post(id, {
            origin: "http://localhost:3025",
            host: "localhost:3025",
          });

          expect(response.status).toBe(303);
          expect((await ownedCounts(forker.userId)).pastes).toBe(1);
        });
      });
    });

    it("says there is nothing to fork for an id that never existed", async () => {
      await withTestOwner(async (forker) => {
        viewer = forker.viewer;

        // `gone` rather than `failed`: the distinction the whole product rests on is that a
        // missing paste and a broken server are different answers.
        expect(await forkAndFollow("zzzzzzzz")).toBe(
          "/p/zzzzzzzz?fork=gone",
        );
      });
    });
  },
);
