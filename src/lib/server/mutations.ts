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

/** M7. Scan runs before the insert, so a blocked body never gets an identifier (§6.1). */
export async function createPaste(
  viewer: Viewer,
  _input: CreatePasteInput,
): Promise<Paste> {
  assertCan(viewer, "paste:create");
  throw new NotImplementedInStaticPhase("createPaste", "M7");
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
