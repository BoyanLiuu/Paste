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
import { userIdFor } from "@/lib/server/users";
import { assertCan } from "@/lib/server/viewer";
import type {
  Paste,
  RemovalReason,
  Relationship,
  RetentionCode,
  Viewer,
} from "@/lib/types";

/**
 * Thrown by every mutation during phase 1.
 *
 * The message is asserted by a test and shown by the "nothing was sent" screens, so it
 * is part of the contract rather than debug text.
 */
export class NotImplementedInStaticPhase extends Error {
  constructor(
    readonly operation: string,
    readonly landsIn: string,
  ) {
    super(
      `${operation} is not implemented in the static phase; it lands in ${landsIn}`,
    );
    this.name = "NotImplementedInStaticPhase";
  }
}

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

/** M11. A fork re-runs the scanner, because a fork is a create (§6.3). */
export async function forkPaste(
  viewer: Viewer,
  _id: string,
  _retention: RetentionCode,
): Promise<Paste> {
  assertCan(viewer, "paste:fork");
  throw new NotImplementedInStaticPhase("forkPaste", "M11");
}

/** M11. 403 at submit unless owner, manager-of-owner or security. */
export async function requestRemoval(
  viewer: Viewer,
  _id: string,
  _input: RequestRemovalInput,
): Promise<void> {
  assertCan(viewer, "removal:request");
  throw new NotImplementedInStaticPhase("requestRemoval", "M11");
}

/** M11. Must lose a race: the second decision on one request gets 409. */
export async function decideRequest(
  viewer: Viewer,
  _requestId: number,
  _input: DecideRequestInput,
): Promise<void> {
  assertCan(viewer, "removal:decide");
  throw new NotImplementedInStaticPhase("decideRequest", "M11");
}
