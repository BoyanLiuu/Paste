// Every mutation the product has, declared now and implemented later.
//
// Appendix C rule 4: the forms render and validate in phase 1 but cannot persist. That
// is not a placeholder — the prototype designs the screens for it (ux-05, 36, 44, 46),
// which say plainly that nothing was sent. Declaring the functions here means M2's
// create form calls the real mutation and only its body changes at M7.
//
// Each one asserts its capability before throwing, so the gate is exercised from the
// first milestone rather than added alongside the implementation.

import "server-only";

import { DEFAULT_RETENTION } from "@/lib/expiry/retention";
import { createPasteInDatabase } from "@/lib/server/create-paste";
import {
  decideInDatabase,
  decidePostCommit,
  keysToDelete,
} from "@/lib/server/decide";
import { forkPasteInDatabase } from "@/lib/server/fork";
import { requestRemovalInDatabase } from "@/lib/server/removal";
import { userIdFor } from "@/lib/server/users";
import { assertCan, isModerator } from "@/lib/server/viewer";
import type {
  Paste,
  RemovalReason,
  Relationship,
  RetentionCode,
  Viewer,
} from "@/lib/types";

// `NotImplementedInStaticPhase` lived here and is gone.
//
// Every mutation this module declares is now implemented — `createPaste` at M7, the other
// three at M11 — so the class had no throw site left and existed only to be asserted by
// the test that asserted it. The phase-1 "nothing was sent" screens it fed (ux-05, 36, 44,
// 46) describe a state the product no longer has.
//
// What it bought was real while it lasted: declaring all four signatures at M1 and letting
// them refuse meant M2's form called the real mutation from the first week, and M7 and M11
// changed bodies rather than call sites.

export interface CreatePasteInput {
  body: string;
  language?: string;
  lineNumbers?: boolean;
  retention?: RetentionCode;
  neverReason?: string;
  title?: string;
  filename?: string;
  /** Which caller: the form, the CLI or a direct API client. Recorded on the paste and
   *  in the audit row, and it decides the size ceiling (§4 stage 3). */
  createdVia?: "web" | "api";
  /** sha256(ip + daily salt), never the address itself (§6.1). */
  createdIpHash?: string;
  /** A justification for tier-2/3 findings the creator chose to save past. Tier 1 is not
   *  overridable and there is deliberately no way to express that here. */
  override?: { justification: string };
}

export interface RequestRemovalInput {
  relationship: Relationship;
  reason: RemovalReason;
  justification: string;
}

export interface DecideRequestInput {
  action: "redact" | "delete" | "deny";
  note: string;
}

/**
 * Store a paste. The scan runs before the insert, so a blocked body never gets an
 * identifier (§6.1).
 *
 * Implemented at M7. The signature is the one M1 declared and M2's form has been calling
 * since — which is the whole return on Appendix C: this milestone changed a body, not a
 * call site.
 *
 * Throws `BlockedBySecretScan` on a tier-1 hit and `NeedsOverride` on an unjustified
 * tier-2/3 one. Both are refusals the route maps to a 422; neither writes a paste row.
 */
export async function createPaste(
  viewer: Viewer,
  input: CreatePasteInput,
): Promise<Paste> {
  assertCan(viewer, "paste:create");

  // Outside the create, so a failed attempt does not repeat it. See users.ts.
  const ownerId = await userIdFor(viewer);

  return createPasteInDatabase({
    ownerId,
    body: input.body,
    title: input.title,
    language: input.language,
    filename: input.filename,
    lineNumbers: input.lineNumbers ?? false,
    retention: input.retention ?? DEFAULT_RETENTION,
    neverReason: input.neverReason,
    createdVia: input.createdVia ?? "web",
    createdIpHash: input.createdIpHash,
    override: input.override,
  });
}

/**
 * Fork a paste. Re-runs the scanner, because a fork is a create (§6.3).
 *
 * A tier-1 hit therefore refuses the fork even though the source still reads fine — the
 * source is grandfathered because destroying it is a separate decision with its own queue,
 * while a new paste has no such claim. See `fork.ts`.
 */
export async function forkPaste(
  viewer: Viewer,
  id: string,
  retention: RetentionCode,
  neverReason?: string,
): Promise<Paste> {
  assertCan(viewer, "paste:fork");
  const ownerId = await userIdFor(viewer);

  return forkPasteInDatabase({
    sourceId: id,
    ownerId,
    retention,
    neverReason,
  });
}

/**
 * Open a removal request. Refused at submit unless the viewer owns the paste or moderates.
 *
 * `relationship` is what the requester claims about themselves, recorded for the moderator
 * to read and never the thing that grants permission — `removal.ts` explains why
 * `manager_of_owner` is refused rather than trusted.
 */
export async function requestRemoval(
  viewer: Viewer,
  id: string,
  input: RequestRemovalInput,
): Promise<{ requestId: number }> {
  assertCan(viewer, "removal:request");
  const requesterId = await userIdFor(viewer);

  return requestRemovalInDatabase({
    pasteId: id,
    requesterId,
    isModerator: isModerator(viewer),
    relationship: input.relationship,
    reason: input.reason,
    justification: input.justification,
  });
}

/**
 * Decide a removal request. Must lose a race: the second decision gets 409.
 *
 * Two moderators opening the same queue is the normal way a queue gets worked, not a rare
 * race — `decide.ts` makes the claim and the conflict check one statement for that reason.
 */
export async function decideRequest(
  viewer: Viewer,
  requestId: number,
  input: DecideRequestInput,
): Promise<void> {
  assertCan(viewer, "removal:decide");
  const moderatorId = await userIdFor(viewer);

  // The storage keys are read BEFORE the transaction nulls them, and the objects are
  // deleted after it commits. A bucket delete cannot be rolled back, so doing it inside
  // would destroy bytes a failed transaction then claims still exist.
  const request = await requestSubject(requestId);
  const keys =
    request === null ? [] : await keysToDelete(request.pasteId, input.action);

  await decideInDatabase({
    requestId,
    moderatorId,
    action: input.action,
    note: input.note,
  });

  await decidePostCommit(keys);
}

/** The paste a request is about, for reading its storage keys before they are nulled. */
async function requestSubject(
  requestId: number,
): Promise<{ pasteId: string } | null> {
  const { prisma } = await import("@/lib/server/prisma");
  return prisma.deletionRequest.findUnique({
    where: { id: requestId },
    select: { pasteId: true },
  });
}
