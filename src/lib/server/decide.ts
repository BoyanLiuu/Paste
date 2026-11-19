// Deciding a removal request (ARCHITECTURE §3, §6.3).
//
// Three outcomes: REDACT replaces the offending bytes with a marker revision, DELETE purges
// the paste outright, DENY leaves it standing. The bias is toward retention, so redaction
// is the usual answer for a leaked secret and deletion is the exception.
//
// TWO MODERATORS WILL OPEN THE SAME QUEUE ON DAY ONE. That is not a rare race to be
// defended against reluctantly; it is the normal way a queue gets worked. So the decision
// is `UPDATE … WHERE status = 'open'` and a zero-row result is a 409 — never a second
// decision silently overwriting the first, which would leave the audit trail showing one
// outcome and the paste in another.
//
// A REDACTION IS VISIBLE, PERMANENTLY. §6.3: a silent redaction is strictly worse than
// none, because it makes every other paste's content unverifiable too. Revision 1 is
// purged, revision 2 carries the replacement, and the notice is rendered from the presence
// of those two revisions rather than from a flag someone could clear.

import "server-only";

import { recordIn } from "@/lib/audit";
import { normalise } from "@/lib/normalise";
import { prisma } from "@/lib/server/prisma";
import { deleteBody, storageConfigured } from "@/lib/storage/body";

export type Decision = "redact" | "delete" | "deny";

export interface DecideArgs {
  requestId: number;
  moderatorId: string;
  action: Decision;
  note: string;
}

/** Someone else decided it first. The route maps this to 409. */
export class AlreadyDecided extends Error {
  constructor(readonly requestId: number) {
    super(`request ${requestId} is no longer open`);
    this.name = "AlreadyDecided";
  }
}

/**
 * The status each decision writes, spelled out rather than derived.
 *
 * It was `` `${action}ed` ``, which is right for two of the three and silently wrong for
 * the third: `"delete" + "ed"` is `"deleteed"`. Nothing caught it, because the conflict
 * tests assert `status !== "open"` and the queue only ever filters on `"open"` — so the
 * typo lived in the one column a later query keys on, and the first thing to read it back
 * (the tombstone's removal notice) found nothing and reported the paste as having lapsed.
 */
const STATUS_FOR: Record<Decision, string> = {
  redact: "redacted",
  delete: "deleted",
  deny: "denied",
};

/** What a redacted revision says in place of the bytes that were removed. */
export const REDACTION_MARKER =
  "«redacted: this revision contained a secret and was removed»\n";

export async function decideInDatabase(args: DecideArgs): Promise<{
  pasteId: string;
  action: Decision;
}> {
  const note = args.note.trim();
  if (note === "") {
    // A decision with no note is a decision nobody can review. The queue's whole value is
    // that someone months later can see why.
    throw new Error("a decision note is required");
  }

  return prisma.$transaction(async (tx) => {
    // THE CLAIM, AND THE CONFLICT CHECK, IN ONE STATEMENT.
    //
    // `updateMany … where status = 'open'` returns a count, and zero means another
    // moderator got there first. A `findFirst` then `update` would read "open", lose the
    // race, and overwrite a decision that had already been recorded and acted on.
    const claimed = await tx.deletionRequest.updateMany({
      where: { id: args.requestId, status: "open" },
      data: {
        status: STATUS_FOR[args.action],
        decidedById: args.moderatorId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });

    if (claimed.count === 0) throw new AlreadyDecided(args.requestId);

    const request = await tx.deletionRequest.findUniqueOrThrow({
      where: { id: args.requestId },
      select: { pasteId: true, reasonCode: true },
    });

    if (args.action === "redact") {
      await redact(tx, request.pasteId, args.moderatorId);
    } else if (args.action === "delete") {
      await destroy(tx, request.pasteId);
    }

    // RECORDED AGAINST THE PASTE AS WELL AS THE REQUEST, when bytes were destroyed.
    //
    // Two subjects because the trail is read from two directions. `removal.decided` below
    // answers "what happened to request 106"; this answers "what happened to /p/<id>" —
    // and that is the question someone holding a two-year-old link actually asks. Without
    // it the paste's own history showed a creation and then nothing, while the sweeper's
    // automatic purges DID appear, so the gap sat exactly where a human had acted.
    if (args.action !== "deny") {
      await recordIn(tx, {
        action: args.action === "redact" ? "paste.redacted" : "paste.purged",
        subjectType: "paste",
        subjectId: request.pasteId,
        actorId: args.moderatorId,
        payload: { request: args.requestId, reason: request.reasonCode, note },
      });
    }

    // Inside the transaction, so a rolled-back decision cannot leave a record claiming it
    // happened — the failure mode that would make this trail worthless.
    await recordIn(tx, {
      action: "removal.decided",
      subjectType: "request",
      subjectId: String(args.requestId),
      actorId: args.moderatorId,
      payload: {
        pasteId: request.pasteId,
        decision: args.action,
        reason: request.reasonCode,
        note,
      },
    });

    return { pasteId: request.pasteId, action: args.action };
  });
}

/**
 * Redact: purge the current revision's bytes and append a replacement.
 *
 * The order matters for the same reason it does in the sweeper. The marker revision is
 * written FIRST so the paste never exists without a servable body — a reader arriving
 * between the two statements gets the marker rather than a paste with no revision, which
 * the mapper refuses to build at all.
 */
async function redact(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  pasteId: string,
  moderatorId: string,
): Promise<void> {
  const head = await tx.revision.findFirstOrThrow({
    where: { pasteId },
    orderBy: { revisionNo: "desc" },
  });

  const marker = normalise(REDACTION_MARKER);

  await tx.revision.create({
    data: {
      pasteId,
      revisionNo: head.revisionNo + 1,
      byteSize: marker.byteSize,
      lineCount: marker.lineCount,
      sha256: marker.sha256,
      bodyText: marker.body,
      reason: "redaction",
      scanState: "complete",
      createdById: moderatorId,
    },
  });

  // The old bytes go. Both pointers to NULL with `purged_at` set is the only body mutation
  // the M6 trigger permits, and it is what makes this a removal rather than a cover-up.
  //
  // `sha256`, `byte_size` and `line_count` survive untouched — the trigger would reject
  // changing them anyway. That residue is the point: a tombstone can still prove what used
  // to be there, so someone holding a local copy can check it (§6.3).
  if (head.purgedAt === null) {
    await tx.revision.update({
      where: { id: head.id },
      data: { bodyText: null, storageKey: null, purgedAt: new Date() },
    });
  }

  // The rendered HTML is a copy of the body. A redacted paste still holding its render has
  // been hidden, not redacted — the same mistake the sweeper's phase B guards against.
  await tx.render.deleteMany({ where: { revisionId: head.id } });

  await tx.paste.update({
    where: { id: pasteId },
    data: { state: "redacted", updatedAt: new Date() },
  });

  // The object, if there was one, is deleted AFTER the transaction commits — see the note
  // in `decidePostCommit`. Storage is not transactional, so deleting it here would destroy
  // bytes that a rollback then claimed still exist.
}

/** Delete: mark the paste purged and drop its bytes. The irreversible outcome. */
async function destroy(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  pasteId: string,
): Promise<void> {
  const revisions = await tx.revision.findMany({
    where: { pasteId },
    select: { id: true, purgedAt: true },
  });

  for (const revision of revisions) {
    if (revision.purgedAt === null) {
      await tx.revision.update({
        where: { id: revision.id },
        data: { bodyText: null, storageKey: null, purgedAt: new Date() },
      });
    }
    await tx.render.deleteMany({ where: { revisionId: revision.id } });
  }

  // `purged`, not deleted. The row survives so the id keeps answering 410 with a
  // tombstone — destroying the row would turn every citing document's link into a 404,
  // which is the thing this product exists not to do (§6.3).
  await tx.paste.update({
    where: { id: pasteId },
    data: { state: "purged", updatedAt: new Date() },
  });
}

/**
 * Object-storage cleanup, after the decision has committed.
 *
 * SEPARATE FROM THE TRANSACTION, deliberately. A bucket delete cannot be rolled back, so
 * doing it inside would destroy bytes that a failed transaction then claims are still
 * there — a paste reading as live with its object gone, which every read path answers as
 * an empty body.
 *
 * The cost of this ordering is a possible orphaned object if the process dies between the
 * commit and this call. That is the trade §6.4 already makes explicit: an orphan is wasted
 * bytes the weekly report finds, while a dangling pointer is a visible lie.
 */
export async function decidePostCommit(keys: string[]): Promise<void> {
  if (keys.length === 0 || !storageConfigured()) return;

  for (const key of keys) {
    try {
      await deleteBody(key);
    } catch (error) {
      // The decision stands; the object is now an orphan for `orphans.sql` to surface.
      console.error(`decide: could not delete object ${key}`, error);
    }
  }
}

/** The storage keys a decision is about to orphan, read before the transaction nulls them. */
export async function keysToDelete(
  pasteId: string,
  action: Decision,
): Promise<string[]> {
  if (action === "deny") return [];

  const revisions = await prisma.revision.findMany({
    where: {
      pasteId,
      storageKey: { not: null },
      purgedAt: null,
    },
    orderBy: { revisionNo: "desc" },
    select: { storageKey: true, revisionNo: true },
  });

  // A delete purges every revision; a redaction purges only the head. Filtered here rather
  // than in the query, because the head is "the highest revision_no that still has bytes"
  // and that is an ordering question, not a WHERE clause.
  const keys = revisions.map((r) => r.storageKey).filter((k): k is string => k !== null);
  return action === "delete" ? keys : keys.slice(0, 1);
}
