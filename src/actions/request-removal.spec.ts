// @vitest-environment node

// The removal form's refusal, as a state rather than an error page (ux-35).
//
// `removal-authz.spec.ts` asserts that a stranger's request is refused and writes no row.
// This asserts the form's half: the refusal comes back as a value, with the reason, and the
// justification they typed is still theirs to fix. A thrown error would replace the page
// and lose a paragraph someone wrote about a security problem — which is how a reasonable
// report becomes an abandoned one.
//
// It also pins the validation to the LISTS rather than to a cast. A `FormData` value is
// whatever was posted, so `relationship` cast straight to the union is an invented string
// reaching the database, where it sits in the queue as a relationship no screen can render.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ownedCounts,
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

const reason = skipReason();

let viewer: Viewer = { kind: "anon" };
vi.mock("@/lib/server/session", () => ({
  getViewer: async () => viewer,
}));

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function submit(fields: Record<string, string>) {
  const { requestRemovalAction } = await import("@/actions/request-removal");
  return requestRemovalAction({ kind: "idle" }, form(fields));
}

const GOOD = {
  relationship: "owner",
  reason: "secret",
  justification: "the password is on line 3",
};

describe.skipIf(reason !== null)(
  `the removal request form${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    beforeEach(() => {
      viewer = { kind: "anon" };
    });

    it("opens a request for the owner and names its number", async () => {
      await withTestOwner(async (owner) => {
        viewer = owner.viewer;
        const [id] = await seedPastes(owner.userId, [
          { body: "password: hunter2hunter2\n" },
        ]);

        const state = await submit({ ...GOOD, id });
        expect(state.kind).toBe("sent");
        // The number is the only thing the requester can cite later: the decision and the
        // audit trail both key on it.
        expect(state.kind === "sent" && state.requestId).toBeGreaterThan(0);
      });
    });

    it("refuses a stranger with the reason, and writes nothing", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{ body: "x = 1\n" }]);

        await withTestOwner(async (stranger) => {
          viewer = stranger.viewer;

          const state = await submit({ ...GOOD, id, relationship: "other" });
          expect(state.kind).toBe("refused");
          expect(state.kind === "refused" && state.message).toMatch(/owner/i);

          // NO ROW. The queue is the denial-of-service surface, so a refused request must
          // not leave an entry on it — not even one marked refused.
          expect(
            await prisma.deletionRequest.count({
              where: { requesterId: stranger.userId },
            }),
          ).toBe(0);
        });
      });
    });

    it("refuses a claimed relationship it cannot verify", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{ body: "x = 1\n" }]);

        await withTestOwner(async (stranger) => {
          viewer = stranger.viewer;

          // `manager_of_owner` is a dropdown option, which is exactly why it cannot grant
          // anything. The refusal says so rather than pretending the claim was checked.
          const state = await submit({
            ...GOOD,
            id,
            relationship: "manager_of_owner",
          });
          expect(state.kind).toBe("refused");
          expect(state.kind === "refused" && state.message).toMatch(
            /org graph|cannot be verified/i,
          );
        });
      });
    });

    it("refuses a relationship or reason that is not on the list", async () => {
      await withTestOwner(async (owner) => {
        viewer = owner.viewer;
        const [id] = await seedPastes(owner.userId, [{ body: "x = 1\n" }]);

        for (const bad of [
          { ...GOOD, id, relationship: "administrator" },
          { ...GOOD, id, reason: "because" },
        ]) {
          expect((await submit(bad)).kind).toBe("refused");
        }

        // And none of them reached the table, which is the point of validating against the
        // list rather than casting the posted string to the union.
        expect((await ownedCounts(owner.userId)).pastes).toBe(1);
        expect(
          await prisma.deletionRequest.count({
            where: { requesterId: owner.userId },
          }),
        ).toBe(0);
      });
    });

    it("refuses an empty justification before it reaches the queue", async () => {
      await withTestOwner(async (owner) => {
        viewer = owner.viewer;
        const [id] = await seedPastes(owner.userId, [{ body: "x = 1\n" }]);

        // A request with no reason is one a moderator cannot decide, so it sits in the
        // queue forever — and the queue's only cost is attention.
        const state = await submit({ ...GOOD, id, justification: "   " });
        expect(state.kind).toBe("refused");
        expect(
          await prisma.deletionRequest.count({
            where: { requesterId: owner.userId },
          }),
        ).toBe(0);
      });
    });

    it("returns the existing request instead of opening a second one", async () => {
      await withTestOwner(async (owner) => {
        viewer = owner.viewer;
        const [id] = await seedPastes(owner.userId, [{ body: "x = 1\n" }]);

        const first = await submit({ ...GOOD, id });
        const second = await submit({ ...GOOD, id });

        // One open request per paste. Two rows about the same paste is two moderators
        // reading the same complaint, and the second decision would hit the 409.
        expect(first).toEqual(second);
        expect(
          await prisma.deletionRequest.count({ where: { pasteId: id } }),
        ).toBe(1);
      });
    });
  },
);
