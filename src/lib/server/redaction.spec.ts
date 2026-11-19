// @vitest-environment node

// A redaction that hides rather than removes (ARCHITECTURE §6.3, ux-27).
//
// The failure this guards is the easy, tempting implementation: set `state = 'redacted'`,
// render the notice, and leave the bytes where they are. Every screen looks right. The
// secret is still in the database, still in `paste_renders` as HTML, and still served by
// `/raw` if anything forgets to check the state — which is the kind of bug found by a
// subpoena rather than by a test.
//
// So: revision 1's body AND its render row are gone, revision 2 holds the replacement, and
// `sha256` survives. That last part is not an oversight — it is the minimum residue that
// lets a tombstone prove what used to be there, so someone holding a local copy can
// confirm it is the same text (§6.3).
//
// And the notice is permanent, because a silent redaction is strictly worse than none: it
// makes every other paste's content unverifiable too.

import { describe, expect, it } from "vitest";

import { REDACTION_MARKER } from "@/lib/server/decide";
import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { decideRequest, requestRemoval } from "@/lib/server/mutations";
import { PASTE_INCLUDE, toPaste } from "@/lib/server/map";
import {
  getPaste,
  getRaw,
  getRenderForPaste,
} from "@/lib/server/paste-service";
import { prisma } from "@/lib/server/prisma";
import { scan, worstTier } from "@/lib/secrets/scan";
import type { Viewer } from "@/lib/types";

const VISITOR: Viewer = { kind: "anon" };
const reason = skipReason();

const asModerator = (viewer: Viewer): Viewer =>
  viewer.kind === "user"
    ? { kind: "user", user: { ...viewer.user, isModerator: true } }
    : viewer;

const SECRET_BODY = "db:\n  host: localhost\n  password: hunter2hunter2\n";

describe("the redaction marker", () => {
  it("does not itself trip the scanner", () => {
    // If it did, a redaction would produce a revision the scanner would have blocked —
    // and the next fork of that paste would be refused because of the marker rather than
    // because of the secret. The scanner's placeholder rule carries `^«redacted:` for
    // exactly this, and that coupling is invisible from either side.
    const result = scan(REDACTION_MARKER);
    expect(worstTier(result.findings)).toBeNull();
  });

  it("says what happened, not just that something did", () => {
    // A reader months later has to understand why the body is a sentence. "Redacted" alone
    // reads like a rendering failure.
    expect(REDACTION_MARKER).toMatch(/redacted/i);
    expect(REDACTION_MARKER).toMatch(/secret/i);
  });
});

describe.skipIf(reason !== null)(
  `redacting a paste${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    /** An owner, a paste with a secret, a render, and an open request about it. */
    async function queued(owner: {
      userId: string;
      viewer: Viewer;
    }): Promise<{ pasteId: string; requestId: number; revisionId: string }> {
      const [pasteId] = await seedPastes(owner.userId, [{ body: SECRET_BODY }]);

      const revision = await prisma.revision.findFirstOrThrow({
        where: { pasteId },
        select: { id: true },
      });
      // A stored render, so the test can assert it is destroyed. Without one the
      // "render row is gone" assertion would pass against a paste that never had it.
      await prisma.render.create({
        data: {
          revisionId: revision.id,
          theme: "paste",
          html: "<pre>password: hunter2hunter2</pre>",
        },
      });

      const { requestId } = await requestRemoval(owner.viewer, pasteId, {
        relationship: "owner",
        reason: "secret",
        justification: "the password is in it",
      });

      return { pasteId, requestId, revisionId: revision.id };
    }

    it("destroys revision 1's bytes and its render, and keeps its hash", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId, revisionId } = await queued(owner);

        const before = await prisma.revision.findUniqueOrThrow({
          where: { id: revisionId },
          select: { sha256: true, byteSize: true, lineCount: true },
        });

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "redact",
          note: "password on line 3",
        });

        const after = await prisma.revision.findUniqueOrThrow({
          where: { id: revisionId },
        });

        // THE BYTES ARE GONE, both pointers, which is the only body mutation the M6
        // trigger permits.
        expect(after.bodyText).toBeNull();
        expect(after.storageKey).toBeNull();
        expect(after.purgedAt).not.toBeNull();

        // THE RENDER IS GONE. Rendered HTML is a copy of the body — a redacted paste
        // still holding one has been hidden, not redacted.
        expect(await prisma.render.count({ where: { revisionId } })).toBe(0);

        // THE HASH SURVIVES, with the size and line count. The trigger would reject
        // changing them, and they are what lets a tombstone prove what was there.
        expect(after.sha256).toBe(before.sha256);
        expect(after.byteSize).toBe(before.byteSize);
        expect(after.lineCount).toBe(before.lineCount);

        // And nothing anywhere still holds the secret.
        const raw = await getRaw(VISITOR, pasteId);
        expect(raw ?? "").not.toContain("hunter2hunter2");
      });
    });

    it("appends revision 2 with the marker, and serves it", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId } = await queued(owner);

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "redact",
          note: "password on line 3",
        });

        const revisions = await prisma.revision.findMany({
          where: { pasteId },
          orderBy: { revisionNo: "asc" },
        });
        expect(revisions).toHaveLength(2);
        expect(revisions[1].reason).toBe("redaction");
        expect(revisions[1].bodyText).toBe(REDACTION_MARKER);

        // The URL still resolves and serves the replacement, which is the point: a
        // redaction must not break the link that cited the paste.
        const paste = await getPaste(VISITOR, pasteId);
        expect(paste).not.toBeNull();
        expect(paste!.body).toBe(REDACTION_MARKER);
        expect(paste!.state).toBe("redacted");
        expect(await getRaw(VISITOR, pasteId)).toBe(REDACTION_MARKER);
      });
    });

    it("leaves the paste readable rather than gone", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId } = await queued(owner);

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "redact",
          note: "password on line 3",
        });

        // `redacted` is a LIVE state — the shared liveness rule says so, and M9 corrected
        // two copies that had it as gone. A redacted paste serves its cleaned revision
        // with a permanent notice; answering 410 would hide the fact of the redaction,
        // which is what §6.3 forbids.
        const { livenessFrom } = await import("@/lib/expiry/liveness");
        const paste = await getPaste(VISITOR, pasteId);
        expect(livenessFrom(paste!).kind).toBe("live");
      });
    });

    it("has no render for the replacement until the backfill runs", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId } = await queued(owner);

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "redact",
          note: "password on line 3",
        });

        // The redaction does not render, and must not: N2 is "0 highlighter invocations on
        // the read path" and a decision is not a read path either. The view page falls
        // back to escaped text with a banner, and `/api/renders` fills it in later.
        expect(await getRenderForPaste(VISITOR, pasteId)).toBeNull();
      });
    });

    it("destroys every revision when the decision is delete, not redact", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId, revisionId } = await queued(owner);

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "delete",
          note: "cannot be redacted safely",
        });

        const paste = await prisma.paste.findUniqueOrThrow({
          where: { id: pasteId },
        });
        // `purged`, and the ROW SURVIVES. Deleting it would turn every citing document's
        // link into a 404, which is the thing this product exists not to do.
        expect(paste.state).toBe("purged");

        const revision = await prisma.revision.findUniqueOrThrow({
          where: { id: revisionId },
        });
        expect(revision.bodyText).toBeNull();
        expect(revision.purgedAt).not.toBeNull();
        // No marker revision: a delete is not a replacement.
        expect(await prisma.revision.count({ where: { pasteId } })).toBe(1);
        expect(await prisma.render.count({ where: { revisionId } })).toBe(0);
      });
    });

    it("gives a deleted paste a receipt that names the removal, not a date", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId } = await queued(owner);

        // A paste created minutes ago, with retention still running. Before the mapper
        // read the decision, `state = 'purged'` sent the 410 down its retention branch:
        // "It expired on {expiresAt} and its bytes were purged on {purgeAfter}" — both
        // dates in the FUTURE, on the one screen whose job is to be believed by someone
        // reading a two-year-old ticket.
        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "delete",
          note: "a live credential",
        });

        const paste = await prisma.paste.findUniqueOrThrow({
          where: { id: pasteId },
          include: PASTE_INCLUDE,
        });
        const mapped = toPaste(paste);

        expect(mapped.removedBy).not.toBeNull();
        expect(mapped.removedBy!.who).toBe(owner.username);
        expect(mapped.removedBy!.reason).toBe("secret");
        expect(mapped.removedBy!.request).toBe(requestId);
        // The citation the receipt and the audit trail share.
        expect(mapped.request).toBe(requestId);

        const { tombstoneFor } = await import("@/lib/expiry/tombstone");
        const { livenessFrom } = await import("@/lib/expiry/liveness");
        const liveness = livenessFrom(mapped);
        expect(liveness.kind).toBe("gone");
        // `removed`, which is what selects the branch that states what happened.
        expect(liveness.kind === "gone" && liveness.reason).toBe("removed");
        expect(tombstoneFor(mapped, "removed").removedBy?.who).toBe(
          owner.username,
        );
      });
    });

    it("records the decision against the paste as well as the request", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId } = await queued(owner);

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "redact",
          note: "password on line 3",
        });

        // TWO SUBJECTS, because the trail is read from two directions: "what happened to
        // request 106" and "what happened to /p/<id>". Someone holding a two-year-old link
        // asks the second one — and it used to answer with a creation and then nothing,
        // while the sweeper's automatic purges did show up. The gap sat precisely where a
        // human had acted.
        const { trailFor } = await import("@/lib/audit");
        const onPaste = await trailFor("paste", pasteId);
        const onRequest = await trailFor("request", String(requestId));

        expect(onPaste.map((e) => e.action)).toContain("paste.redacted");
        expect(onRequest.map((e) => e.action)).toContain("removal.decided");
        // And it cites the request, so the two halves can be joined by a reader.
        const entry = onPaste.find((e) => e.action === "paste.redacted")!;
        expect((entry.payload as { request: number }).request).toBe(requestId);
        expect(entry.actor).toBe(owner.username);
      });
    });

    it("does not mark a redacted paste as removed", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId } = await queued(owner);

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "redact",
          note: "password on line 3",
        });

        const paste = await prisma.paste.findUniqueOrThrow({
          where: { id: pasteId },
          include: PASTE_INCLUDE,
        });
        // `removedBy` makes `livenessFrom` answer gone, so setting it for a redaction
        // would 410 a paste that serves its cleaned revision — the regression M9 already
        // had to undo in two other copies of this rule.
        expect(toPaste(paste).removedBy).toBeNull();
        expect(toPaste(paste).request).toBeNull();
      });
    });

    it("leaves a denied request off the face of the paste", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId } = await queued(owner);

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "deny",
          note: "a fixture, not a credential",
        });

        const paste = await prisma.paste.findUniqueOrThrow({
          where: { id: pasteId },
          include: PASTE_INCLUDE,
        });
        // `request` drives the list row's "under review" badge. Carrying a denial there
        // would mark the paste as under review permanently, after a decision whose whole
        // point was that nothing happened.
        expect(toPaste(paste).request).toBeNull();
      });
    });

    it("leaves everything alone when the decision is deny", async () => {
      await withTestOwner(async (owner) => {
        const { pasteId, requestId, revisionId } = await queued(owner);

        await decideRequest(asModerator(owner.viewer), requestId, {
          action: "deny",
          note: "the password is a fixture, not a credential",
        });

        const revision = await prisma.revision.findUniqueOrThrow({
          where: { id: revisionId },
        });
        // Untouched: body, render and state. The bias is toward retention, and a denial
        // that quietly destroyed something would be the worst of both.
        expect(revision.bodyText).toBe(SECRET_BODY);
        expect(revision.purgedAt).toBeNull();
        expect(await prisma.render.count({ where: { revisionId } })).toBe(1);

        const paste = await prisma.paste.findUniqueOrThrow({
          where: { id: pasteId },
        });
        expect(paste.state).toBe("live");
      });
    });
  },
);
