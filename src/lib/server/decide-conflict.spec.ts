// @vitest-environment node

// The lost update two moderators will cause on day one (ARCHITECTURE §3, ux-47).
//
// This is not a rare race to be defended against reluctantly. Two people opening the same
// queue is how a queue gets worked: both see the request, both form a view, both click.
// The natural implementation — read the request, check `status === "open"`, update it —
// loses that race every time, and loses it silently: the second decision overwrites the
// first, so the audit trail shows one outcome while the paste is in another.
//
// Worse, the two decisions can differ. The first moderator redacts, the second denies, and
// the request ends up marked denied against a paste whose bytes are already gone. There is
// no recovering the original from that.
//
// So the claim and the conflict check are ONE statement — `UPDATE … WHERE status = 'open'`
// — and a zero-row result is a 409.

import { describe, expect, it } from "vitest";

import { AlreadyDecided } from "@/lib/server/decide";
import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { decideRequest, requestRemoval } from "@/lib/server/mutations";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

const reason = skipReason();

const asModerator = (viewer: Viewer): Viewer =>
  viewer.kind === "user"
    ? { kind: "user", user: { ...viewer.user, isModerator: true } }
    : viewer;

/** An owner, an open request about their paste, and two moderators. */
async function queued(
  ownerId: string,
  ownerViewer: Viewer,
): Promise<{ pasteId: string; requestId: number }> {
  const [pasteId] = await seedPastes(ownerId, [
    { body: "aws_access_key_id = AKIA...\n" },
  ]);
  const { requestId } = await requestRemoval(ownerViewer, pasteId, {
    relationship: "owner",
    reason: "secret",
    justification: "there is a key in it",
  });
  return { pasteId, requestId };
}

describe.skipIf(reason !== null)(
  `deciding twice${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("gives the second moderator a conflict, not a silent overwrite", async () => {
      await withTestOwner(async (owner) => {
        await withTestOwner(async (first) => {
          await withTestOwner(async (second) => {
            const { requestId } = await queued(owner.userId, owner.viewer);

            await decideRequest(asModerator(first.viewer), requestId, {
              action: "deny",
              note: "the key is already rotated",
            });

            // The second moderator was looking at the same queue and clicks a different
            // button. This must refuse rather than overwrite.
            await expect(
              decideRequest(asModerator(second.viewer), requestId, {
                action: "delete",
                note: "destroy it",
              }),
            ).rejects.toThrow(AlreadyDecided);

            const row = await prisma.deletionRequest.findUniqueOrThrow({
              where: { id: requestId },
            });
            // THE FIRST DECISION STANDS, in full: outcome, decider and note. A silent
            // overwrite would leave `denied` replaced by `deleted` with the second
            // moderator's name on it, and the first decision unrecoverable.
            expect(row.status).toBe("denied");
            expect(row.decidedById).toBe(first.userId);
            expect(row.decisionNote).toBe("the key is already rotated");
          });
        });
      });
    });

    it("leaves the paste in the first decision's state, not the second's", async () => {
      await withTestOwner(async (owner) => {
        await withTestOwner(async (mod) => {
          const { pasteId, requestId } = await queued(
            owner.userId,
            owner.viewer,
          );

          await decideRequest(asModerator(mod.viewer), requestId, {
            action: "deny",
            note: "keep it",
          });

          await expect(
            decideRequest(asModerator(mod.viewer), requestId, {
              action: "delete",
              note: "no, destroy it",
            }),
          ).rejects.toThrow(AlreadyDecided);

          const paste = await prisma.paste.findUniqueOrThrow({
            where: { id: pasteId },
          });
          // Denied means untouched. The dangerous version of this bug is the refused
          // decision still running its side effects — the bytes gone while the request
          // reads `denied`, which is unrecoverable and looks like a database fault.
          expect(paste.state).toBe("live");

          const revision = await prisma.revision.findFirstOrThrow({
            where: { pasteId },
          });
          expect(revision.purgedAt).toBeNull();
          expect(revision.bodyText).not.toBeNull();
        });
      });
    });

    it("records exactly one decision in the audit trail", async () => {
      await withTestOwner(async (owner) => {
        await withTestOwner(async (mod) => {
          const { requestId } = await queued(owner.userId, owner.viewer);

          await decideRequest(asModerator(mod.viewer), requestId, {
            action: "deny",
            note: "fine as it is",
          });
          await decideRequest(asModerator(mod.viewer), requestId, {
            action: "deny",
            note: "fine as it is",
          }).catch(() => undefined);

          const entries = await prisma.auditLog.findMany({
            where: {
              subjectId: String(requestId),
              action: "removal.decided",
            },
          });
          // One. The audit row is written INSIDE the decision's transaction, so a refused
          // second decision cannot leave a record claiming it happened.
          expect(entries).toHaveLength(1);
        });
      });
    });

    it("survives both moderators clicking at the same moment", async () => {
      await withTestOwner(async (owner) => {
        await withTestOwner(async (first) => {
          await withTestOwner(async (second) => {
            const { pasteId, requestId } = await queued(
              owner.userId,
              owner.viewer,
            );

            // Genuinely concurrent, which is the shape the bug actually takes. Sequential
            // calls can pass against a read-then-write implementation if the read happens
            // after the first write commits.
            const results = await Promise.allSettled([
              decideRequest(asModerator(first.viewer), requestId, {
                action: "deny",
                note: "keep",
              }),
              decideRequest(asModerator(second.viewer), requestId, {
                action: "delete",
                note: "destroy",
              }),
            ]);

            const fulfilled = results.filter((r) => r.status === "fulfilled");
            // EXACTLY ONE WINS. Not "at most one" — a decision must be made, and both
            // failing would leave the request open with two moderators believing they had
            // handled it.
            expect(fulfilled).toHaveLength(1);

            const row = await prisma.deletionRequest.findUniqueOrThrow({
              where: { id: requestId },
            });
            expect(row.status).not.toBe("open");

            // And the paste's state matches whichever decision won, rather than being a
            // mixture of both.
            const paste = await prisma.paste.findUniqueOrThrow({
              where: { id: pasteId },
            });
            expect(row.status === "denied" ? "live" : "purged").toBe(
              paste.state,
            );
          });
        });
      });
    });

    it("refuses a status outside the four the code knows", async () => {
      await withTestOwner(async (owner) => {
        const [pasteId] = await seedPastes(owner.userId, [
          { body: "aws_access_key_id = AKIA...\n" },
        ]);

        // THE TYPO THAT SHIPPED: the decision path built its status as `${action}ed`, so a
        // delete wrote "deleteed". Every screen still looked right — the queue filters
        // `status = 'open'` and the conflict tests assert `status <> 'open'` — and the
        // damage surfaced one layer away, in a 410 receipt that reported a destroyed paste
        // as having lapsed. So the domain is enforced here, where all four spellings of
        // this column have to agree.
        await expect(
          prisma.$executeRaw`
            INSERT INTO paste.deletion_requests
              (paste_id, requester_id, relationship, reason_code, justification,
               status, decided_at, decision_note)
            VALUES (${pasteId}, ${owner.userId}::uuid, 'owner', 'secret', 'x',
                    'deleteed', now(), 'x')`,
        ).rejects.toThrow(/deletion_requests_status_valid/);

        // And a decided row must carry the timestamp the receipt prints. Without this the
        // mapper has to choose between an epoch date and dropping the removal notice.
        await expect(
          prisma.$executeRaw`
            INSERT INTO paste.deletion_requests
              (paste_id, requester_id, relationship, reason_code, justification,
               status, decided_at, decision_note)
            VALUES (${pasteId}, ${owner.userId}::uuid, 'owner', 'secret', 'x',
                    'deleted', NULL, 'x')`,
        ).rejects.toThrow(/deletion_requests_status_valid/);
      });
    });

    it("refuses a decision with no note", async () => {
      await withTestOwner(async (owner) => {
        await withTestOwner(async (mod) => {
          const { requestId } = await queued(owner.userId, owner.viewer);

          // A decision nobody can review is not a decision. The queue's whole value is
          // that someone months later can see why.
          await expect(
            decideRequest(asModerator(mod.viewer), requestId, {
              action: "deny",
              note: "  ",
            }),
          ).rejects.toThrow(/note/);

          const row = await prisma.deletionRequest.findUniqueOrThrow({
            where: { id: requestId },
          });
          expect(row.status).toBe("open");
        });
      });
    });
  },
);
