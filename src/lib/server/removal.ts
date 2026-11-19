// Requesting removal of a paste (ARCHITECTURE §3, §6.3).
//
// REMOVAL IS A REQUEST, NOT A BUTTON. There is no delete, and the bias is toward
// retention: a snippet's URL is in a ticket somewhere, and a dead link destroys the audit
// trail that cited it. So an owner asks, a moderator decides, and the decision is on the
// record.
//
// THE RELATIONSHIP CHECK IS CODE, NOT A GUIDELINE. A stranger must not be able to put
// someone else's snippet into the queue — not because a moderator would wrongly approve
// it, but because the queue itself is a denial-of-service surface and "who may ask" is the
// only thing standing in front of it. §6.3 is explicit that this is a hard rule.

import "server-only";

import { record } from "@/lib/audit";
import { prisma } from "@/lib/server/prisma";
import type { Relationship, RemovalReason } from "@/lib/types";

export interface RemovalArgs {
  pasteId: string;
  requesterId: string;
  isModerator: boolean;
  relationship: Relationship;
  reason: RemovalReason;
  justification: string;
}

/** Refused at submit. The route maps this to 403. */
export class RemovalNotAllowed extends Error {
  constructor(readonly why: string) {
    super(`removal request refused: ${why}`);
    this.name = "RemovalNotAllowed";
  }
}

/** The paste is gone, so there is nothing to remove. */
export class PasteNotFound extends Error {
  constructor(readonly pasteId: string) {
    super(`no paste ${pasteId}`);
    this.name = "PasteNotFound";
  }
}

/**
 * Who may ask, given the relationship they claim.
 *
 * THE CLAIM IS NOT THE AUTHORITY. `relationship` is user input — it is what the form asked
 * them to say about themselves — so it is recorded for the moderator to read and it is
 * never the thing that grants permission. What grants permission is ownership, which the
 * database knows, or the moderator flag, which the session knows.
 *
 * `manager_of_owner` is therefore refused rather than trusted: it needs an org graph this
 * product does not have, and accepting the claim at face value would make the whole check
 * decorative — anyone could select it from a dropdown. Refusing is the honest answer until
 * there is something to check it against (Appendix G).
 */
export function mayRequest(args: {
  isOwner: boolean;
  isModerator: boolean;
  relationship: Relationship;
}): { ok: true } | { ok: false; why: string } {
  if (args.isOwner) return { ok: true };
  if (args.isModerator) return { ok: true };

  if (args.relationship === "manager_of_owner") {
    return {
      ok: false,
      why: "manager-of-owner cannot be verified: there is no org graph to check it against",
    };
  }
  if (args.relationship === "security") {
    return {
      ok: false,
      why: "security requests come from a moderator account, which this session is not",
    };
  }

  return { ok: false, why: "not the owner of this paste" };
}

export async function requestRemovalInDatabase(
  args: RemovalArgs,
): Promise<{ requestId: number }> {
  const justification = args.justification.trim();
  if (justification === "") {
    // Non-empty, enforced here rather than only in the form. A request with no reason is
    // a request a moderator cannot decide, which means it sits in the queue forever.
    throw new RemovalNotAllowed("a justification is required");
  }

  const paste = await prisma.paste.findUnique({
    where: { id: args.pasteId },
    select: { id: true, ownerId: true },
  });
  if (paste === null) throw new PasteNotFound(args.pasteId);

  const verdict = mayRequest({
    isOwner: paste.ownerId === args.requesterId,
    isModerator: args.isModerator,
    relationship: args.relationship,
  });

  if (!verdict.ok) {
    // NO ROW. The refusal happens before the insert, so a refused request leaves nothing
    // behind — not a row with `status='refused'`, which would still be a way to fill the
    // queue table on someone else's behalf.
    throw new RemovalNotAllowed(verdict.why);
  }

  // One open request per paste at a time.
  //
  // Not enforced by a unique index, because the constraint is "one OPEN one" and a partial
  // unique on a mutable status column would have to be dropped and rebuilt every time the
  // status changed. Checked here, and a race that creates two is a moderation annoyance
  // rather than a correctness problem — the second decision gets the 409 from `decide`.
  const open = await prisma.deletionRequest.findFirst({
    where: { pasteId: args.pasteId, status: "open" },
    select: { id: true },
  });
  if (open !== null) return { requestId: open.id };

  const created = await prisma.deletionRequest.create({
    data: {
      pasteId: args.pasteId,
      requesterId: args.requesterId,
      relationship: args.relationship,
      reasonCode: args.reason,
      justification,
      status: "open",
    },
    select: { id: true },
  });

  await record({
    action: "removal.requested",
    subjectType: "request",
    subjectId: String(created.id),
    actorId: args.requesterId,
    payload: {
      pasteId: args.pasteId,
      // The claimed relationship, recorded because the moderator reads it — and clearly
      // separated from what was actually verified, so the record does not imply the claim
      // was checked.
      claimedRelationship: args.relationship,
      verifiedAs: paste.ownerId === args.requesterId ? "owner" : "moderator",
      reason: args.reason,
    },
  });

  return { requestId: created.id };
}
