// @vitest-environment node

// Forking as a laundering path (ARCHITECTURE §6.3).
//
// The scanner's rule set grows. A paste accepted last month passed the rules as they were
// then, and a rule added since may now match it — so if forking copied bytes without
// re-scanning, it would be the one supported way to get a now-known credential into a
// fresh, unblocked paste. And it would be the obvious route, because the original sits
// right there as evidence the content was once allowed.
//
// The implementation makes this hard to get wrong by construction: `fork.ts` delegates to
// the create path rather than copying rows, so every stage applies — normalise, the
// ladder, the scanner, the write transaction. These tests assert the consequence, because
// "it goes through createPaste" is an implementation detail someone could optimise away.
//
// The uncomfortable half: a fork can be REFUSED while its source still reads fine. That is
// correct. The source is grandfathered because destroying it is a separate decision with
// its own queue; a new paste has no such claim.

import { describe, expect, it } from "vitest";

import { BlockedBySecretScan } from "@/lib/server/create-paste";
import {
  ownedCounts,
  seedPastes,
  skipReason,
  slackTokenShape,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { NothingToFork } from "@/lib/server/fork";
import { decideRequest, forkPaste, requestRemoval } from "@/lib/server/mutations";
import { getPaste } from "@/lib/server/paste-service";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

const VISITOR: Viewer = { kind: "anon" };
const reason = skipReason();

const asModerator = (viewer: Viewer): Viewer =>
  viewer.kind === "user"
    ? { kind: "user", user: { ...viewer.user, isModerator: true } }
    : viewer;

describe.skipIf(reason !== null)(
  `forking${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("refuses to fork a body the scanner now blocks", async () => {
      await withTestOwner(async (owner) => {
        // Seeded directly, which is exactly the situation being modelled: the row exists
        // and was never scanned by today's rules. The create path would have refused it.
        const [sourceId] = await seedPastes(owner.userId, [
          { body: `SLACK_TOKEN = "${slackTokenShape()}"\n` },
        ]);

        await withTestOwner(async (forker) => {
          await expect(
            forkPaste(forker.viewer, sourceId, "1d"),
          ).rejects.toThrow(BlockedBySecretScan);

          // NOTHING WRITTEN. The refusal happens before the insert, so the laundering
          // attempt leaves no paste — and therefore no URL for the credential.
          expect((await ownedCounts(forker.userId)).pastes).toBe(0);
        });
      });
    });

    it("leaves the source alone when the fork is refused", async () => {
      await withTestOwner(async (owner) => {
        const body = `SLACK_TOKEN = "${slackTokenShape()}"\n`;
        const [sourceId] = await seedPastes(owner.userId, [{ body }]);

        await withTestOwner(async (forker) => {
          await forkPaste(forker.viewer, sourceId, "1d").catch(() => undefined);

          // The source is grandfathered. Refusing the fork AND destroying the original
          // would be a removal without a request — the decision §6.3 reserves for a
          // moderator and a queue.
          const source = await getPaste(VISITOR, sourceId);
          expect(source).not.toBeNull();
          expect(source!.body).toBe(body);
          expect(source!.state).toBe("live");
        });
      });
    });

    it("records the block against the forker, not the original author", async () => {
      await withTestOwner(async (owner) => {
        const [sourceId] = await seedPastes(owner.userId, [
          { body: `SLACK_TOKEN = "${slackTokenShape()}"\n` },
        ]);

        await withTestOwner(async (forker) => {
          await forkPaste(forker.viewer, sourceId, "1d").catch(() => undefined);

          // Who tried matters: the original author did nothing today. Attributing it to
          // them would point an investigation at the wrong person.
          expect(
            await prisma.auditLog.count({
              where: { actorId: forker.userId, action: "paste.blocked" },
            }),
          ).toBe(1);
          expect(
            await prisma.auditLog.count({
              where: { actorId: owner.userId, action: "paste.blocked" },
            }),
          ).toBe(0);
        });
      });
    });

    it("forks a clean body with new provenance and a new retention", async () => {
      await withTestOwner(async (owner) => {
        const body = "def retry(fn):\n    return fn()\n";
        const [sourceId] = await seedPastes(owner.userId, [
          { body, title: "retry helper", language: "python" },
        ]);

        await withTestOwner(async (forker) => {
          const fork = await forkPaste(forker.viewer, sourceId, "1h");

          // A NEW ID, not a copy of the old one — the fork is its own permanent reference.
          expect(fork.id).not.toBe(sourceId);
          expect(fork.forkedFrom).toBe(sourceId);
          expect(fork.owner).toBe(forker.username);
          expect(fork.body).toBe(body);
          // Its own retention, chosen by the forker rather than inherited: they are the
          // one who now has to live with the expiry.
          expect(fork.retention).toBe("1h");
          // The language is carried rather than re-detected, because the source's may have
          // been an explicit human choice the ladder would overwrite with a guess.
          expect(fork.language).toBe("python");
          expect(fork.title).toBe("retry helper (fork)");

          // And it shows up as a fork on the source's provenance panel.
          const { getForks } = await import("@/lib/server/paste-service");
          const forks = await getForks(VISITOR, sourceId);
          expect(forks.map((f) => f.id)).toContain(fork.id);
        });
      });
    });

    it("refuses to fork a paste whose bytes are gone", async () => {
      await withTestOwner(async (owner) => {
        const [sourceId] = await seedPastes(owner.userId, [
          { body: "secret: hunter2hunter2\n" },
        ]);
        const { requestId } = await requestRemoval(owner.viewer, sourceId, {
          relationship: "owner",
          reason: "secret",
          justification: "password",
        });
        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "delete",
          note: "destroy it",
        });

        await withTestOwner(async (forker) => {
          // An empty fork carrying this paste's provenance would attach its history to
          // content it never had — and would quietly undo the deletion's visibility by
          // creating a live descendant of a purged paste.
          await expect(
            forkPaste(forker.viewer, sourceId, "1d"),
          ).rejects.toThrow(NothingToFork);
        });
      });
    });

    it("refuses to fork an id that never existed", async () => {
      await withTestOwner(async (forker) => {
        await expect(
          forkPaste(forker.viewer, "zzzzzzzz", "1d"),
        ).rejects.toThrow(NothingToFork);
      });
    });

    it("re-runs the scanner rather than trusting the source's scan_state", async () => {
      await withTestOwner(async (owner) => {
        // The source claims a clean scan. If the fork trusted that column instead of
        // scanning the bytes, this is the shape the laundering path would take — and it
        // would look correct in code review, because `scan_state` is right there.
        const [sourceId] = await seedPastes(owner.userId, [
          { body: `SLACK_TOKEN = "${slackTokenShape()}"\n` },
        ]);
        await prisma.revision.updateMany({
          where: { pasteId: sourceId },
          data: { scanState: "complete" },
        });

        await withTestOwner(async (forker) => {
          await expect(
            forkPaste(forker.viewer, sourceId, "1d"),
          ).rejects.toThrow(BlockedBySecretScan);
        });
      });
    });
  },
);
