// Who is asking, and what they may do.
//
// Both functions exist from M1 with their final signatures even though phase 1 has no
// identity provider. That is Appendix C rule 3: visibility rules get written once,
// against fixtures, rather than reinvented against the database. M10 replaces the body
// of getViewer() with Clerk's `auth()` and fills DENIED in — neither is a call-site
// change.

import "server-only";

import { USERS, VIEWER_USERNAME } from "@/lib/fixtures";
import type { Capability, Paste, Viewer } from "@/lib/types";

/** Thrown when a viewer lacks a capability. M10 maps this to 401 or 403. */
export class NotPermittedError extends Error {
  constructor(readonly capability: Capability) {
    super(`not permitted: ${capability}`);
    this.name = "NotPermittedError";
  }
}

/**
 * The current viewer.
 *
 * Phase 1 always resolves the same signed-in fixture user, so every screen can be built
 * in its signed-in state. Phase 3 reads Clerk. The `anon` arm already exists because
 * reads are public (§3) and the view page must render for a signed-out visitor.
 */
export async function getViewer(): Promise<Viewer> {
  // M10: const { userId } = await auth(); if (!userId) return { kind: "anon" };
  return { kind: "user", user: USERS[VIEWER_USERNAME] };
}

/**
 * Capabilities a viewer does **not** have.
 *
 * Empty in phase 1 by design, so nothing is gated before there is an identity to gate
 * on. M10 fills it in, which makes gating a data change rather than a rewrite.
 */
const DENIED: Partial<Record<Viewer["kind"], readonly Capability[]>> = {
  // M10: anon: ["paste:create", "paste:fork", "removal:request", "removal:decide"],
};

/**
 * Assert a viewer may do something. Called by every mutation.
 *
 * Deliberately throws rather than returning a boolean: a permission check whose result
 * can be ignored eventually is.
 */
export function assertCan(viewer: Viewer, capability: Capability): void {
  if (DENIED[viewer.kind]?.includes(capability)) {
    throw new NotPermittedError(capability);
  }
}

/** Whether this viewer may decide removal requests. Separate from assertCan because the
 *  moderation page needs to *render* differently, not just refuse an action. */
export function isModerator(viewer: Viewer): boolean {
  return viewer.kind === "user" && viewer.user.isModerator;
}

/**
 * Whether a viewer may open a removal request for a paste.
 *
 * §6.3 makes this a hard rule in code rather than a moderation guideline: a stranger
 * must not be able to put someone else's snippet into the queue. Phase 1 can only judge
 * ownership and the moderator flag; "manager of owner" needs an org graph that does not
 * exist yet, so it is refused rather than assumed.
 */
export function mayRequestRemoval(viewer: Viewer, paste: Paste): boolean {
  if (viewer.kind !== "user") return false;
  if (viewer.user.username === paste.owner) return true;
  return viewer.user.isModerator;
}
