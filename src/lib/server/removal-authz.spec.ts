// @vitest-environment node

// The hole that would let anyone delete anyone's paste (ARCHITECTURE §3, §6.3).
//
// Removal is a request a moderator decides, so the obvious reading is that authorisation
// lives with the moderator — they can just deny a bad request. That reading is wrong for
// two reasons. The queue is a denial-of-service surface: anyone who can file requests can
// bury the real ones. And a request is itself a public accusation about someone else's
// content, sitting in a queue with their name on it.
//
// So the check is at SUBMIT, in code, and §6.3 calls it a hard rule rather than a
// moderation guideline. These tests assert the refusal leaves NO ROW — not a row marked
// refused, which would still be a way to fill the table on someone else's behalf.

import { describe, expect, it } from "vitest";

import { mayRequest, RemovalNotAllowed } from "@/lib/server/removal";
import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { requestRemoval } from "@/lib/server/mutations";
import { prisma } from "@/lib/server/prisma";
import type { Relationship, Viewer } from "@/lib/types";

const reason = skipReason();

const asModerator = (viewer: Viewer): Viewer =>
  viewer.kind === "user"
    ? { kind: "user", user: { ...viewer.user, isModerator: true } }
    : viewer;

const REQUEST = {
  reason: "secret" as const,
  justification: "there is an AWS key on line 4",
};

describe("mayRequest", () => {
  const RELATIONSHIPS: Relationship[] = [
    "owner",
    "manager_of_owner",
    "security",
    "other",
  ];

  it("lets an owner ask, whatever relationship they claim", () => {
    // Ownership is checked against the database, so the claim is irrelevant when it is
    // true. Someone selecting the wrong dropdown entry about their own paste should not be
    // refused on a technicality.
    for (const relationship of RELATIONSHIPS) {
      expect(mayRequest({ isOwner: true, isModerator: false, relationship }).ok, relationship).toBe(
        true,
      );
    }
  });

  it("lets a moderator ask", () => {
    for (const relationship of RELATIONSHIPS) {
      expect(
        mayRequest({ isOwner: false, isModerator: true, relationship }).ok,
        relationship,
      ).toBe(true);
    }
  });

  it("refuses a stranger, including one claiming to be a manager", () => {
    // THE CLAIM IS NOT THE AUTHORITY. `manager_of_owner` is a dropdown entry, so trusting
    // it makes the entire check decorative — anyone could select it. It is refused until
    // there is an org graph to check it against, which this product does not have.
    const manager = mayRequest({
      isOwner: false,
      isModerator: false,
      relationship: "manager_of_owner",
    });
    expect(manager.ok).toBe(false);
    expect(manager.ok === false && manager.why).toMatch(/org graph/);

    // Same for `security`: a real security request comes from a moderator account, and the
    // dropdown cannot make a session into one.
    const security = mayRequest({
      isOwner: false,
      isModerator: false,
      relationship: "security",
    });
    expect(security.ok).toBe(false);

    expect(
      mayRequest({ isOwner: false, isModerator: false, relationship: "other" }).ok,
    ).toBe(false);
  });
});

describe.skipIf(reason !== null)(
  `requesting removal${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("refuses an unrelated user and writes no row", async () => {
      await withTestOwner(async (owner) => {
        await withTestOwner(async (stranger) => {
          const [id] = await seedPastes(owner.userId, [{}]);

          await expect(
            requestRemoval(stranger.viewer, id, {
              ...REQUEST,
              relationship: "other",
            }),
          ).rejects.toThrow(RemovalNotAllowed);

          // NO ROW AT ALL. A row marked refused would still let a stranger put an entry
          // against someone else's paste into the table.
          expect(
            await prisma.deletionRequest.count({ where: { pasteId: id } }),
          ).toBe(0);
          // And nothing in the audit trail either: a refused request is not an event.
          expect(
            await prisma.auditLog.count({
              where: { actorId: stranger.userId, action: "removal.requested" },
            }),
          ).toBe(0);
        });
      });
    });

    it("refuses a stranger claiming to be the owner's manager", async () => {
      await withTestOwner(async (owner) => {
        await withTestOwner(async (stranger) => {
          const [id] = await seedPastes(owner.userId, [{}]);

          await expect(
            requestRemoval(stranger.viewer, id, {
              ...REQUEST,
              relationship: "manager_of_owner",
            }),
          ).rejects.toThrow(RemovalNotAllowed);

          expect(
            await prisma.deletionRequest.count({ where: { pasteId: id } }),
          ).toBe(0);
        });
      });
    });

    it("lets the owner ask, and records what was verified rather than what was claimed", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{}]);

        const { requestId } = await requestRemoval(owner.viewer, id, {
          ...REQUEST,
          relationship: "owner",
        });

        const row = await prisma.deletionRequest.findUniqueOrThrow({
          where: { id: requestId },
        });
        expect(row.status).toBe("open");
        expect(row.pasteId).toBe(id);
        expect(row.justification).toBe(REQUEST.justification);

        const audit = await prisma.auditLog.findFirstOrThrow({
          where: { subjectId: String(requestId), action: "removal.requested" },
        });
        const payload = audit.payload as Record<string, unknown>;
        // Both, kept apart. The claim is what the moderator reads; `verifiedAs` is what the
        // system actually established — conflating them would make the record imply the
        // dropdown had been checked.
        expect(payload.claimedRelationship).toBe("owner");
        expect(payload.verifiedAs).toBe("owner");
      });
    });

    it("lets a moderator ask about someone else's paste", async () => {
      await withTestOwner(async (owner) => {
        await withTestOwner(async (mod) => {
          const [id] = await seedPastes(owner.userId, [{}]);

          const { requestId } = await requestRemoval(
            asModerator(mod.viewer),
            id,
            { ...REQUEST, relationship: "security" },
          );

          const audit = await prisma.auditLog.findFirstOrThrow({
            where: { subjectId: String(requestId) },
          });
          // Verified as a moderator, not as the claimed `security` relationship.
          expect((audit.payload as Record<string, unknown>).verifiedAs).toBe(
            "moderator",
          );
        });
      });
    });

    it("requires a justification", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{}]);

        // A request with no reason is one a moderator cannot decide, so it sits in the
        // queue forever. Enforced here and not only in the form.
        await expect(
          requestRemoval(owner.viewer, id, {
            ...REQUEST,
            justification: "   ",
            relationship: "owner",
          }),
        ).rejects.toThrow(/justification/);

        expect(
          await prisma.deletionRequest.count({ where: { pasteId: id } }),
        ).toBe(0);
      });
    });

    it("returns the existing request rather than opening a second one", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{}]);

        const first = await requestRemoval(owner.viewer, id, {
          ...REQUEST,
          relationship: "owner",
        });
        const second = await requestRemoval(owner.viewer, id, {
          ...REQUEST,
          relationship: "owner",
        });

        // Idempotent for the impatient. Two open requests for one paste means two
        // moderators can each decide "the" request and reach different outcomes.
        expect(second.requestId).toBe(first.requestId);
        expect(
          await prisma.deletionRequest.count({
            where: { pasteId: id, status: "open" },
          }),
        ).toBe(1);
      });
    });

    it("refuses a request about a paste that does not exist", async () => {
      await withTestOwner(async (owner) => {
        await expect(
          requestRemoval(owner.viewer, "zzzzzzzz", {
            ...REQUEST,
            relationship: "owner",
          }),
        ).rejects.toThrow(/no paste/);
      });
    });
  },
);
