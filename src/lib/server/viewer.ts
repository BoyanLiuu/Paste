// Who is asking, and what they may do.
//
// Both functions have carried their final signatures since M1, when neither had an
// identity provider behind it. That is Appendix C rule 3: visibility rules get written
// once, against fixtures, rather than reinvented against the database. M10 replaced the
// body of `getViewer()` with Clerk's `auth()` and filled in the capability table, and
// NEITHER WAS A CALL-SITE CHANGE — every screen built in phases 1 and 2 reads a real
// session now without moving.
//
// `getViewer()` itself lives in `@/lib/server/session` and is NOT re-exported from here.
// Re-exporting was the first attempt at keeping call sites unchanged, and it defeated the
// point: a re-export is an import, so Clerk went straight back onto the path of
// `assertCan` → `mutations.ts` → most of the suite. The handful of call sites import from
// `session` directly instead.

import "server-only";

import { can } from "@/lib/server/capabilities";
import type { Capability, Paste, Viewer } from "@/lib/types";

/** Thrown when a viewer lacks a capability. M10 maps this to 401 or 403. */
export class NotPermittedError extends Error {
  constructor(readonly capability: Capability) {
    super(`not permitted: ${capability}`);
    this.name = "NotPermittedError";
  }
}

/**
 * Assert a viewer may do something. Called by every mutation.
 *
 * Deliberately throws rather than returning a boolean: a permission check whose result can
 * be ignored eventually is. The table itself is `@/lib/server/capabilities` — M1 left an
 * empty placeholder here and M10 filled it in there, keyed on §2's three actors rather
 * than on `Viewer["kind"]`, which cannot tell a member from a moderator.
 */
export function assertCan(viewer: Viewer, capability: Capability): void {
  if (!can(viewer, capability)) {
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
