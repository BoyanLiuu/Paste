// Who may do what, in one table (ARCHITECTURE §2, §3).
//
// §2 names three actors — visitor, member, moderator — and the asymmetry between them is
// the product's premise rather than a default: READS ARE PUBLIC AND WRITES NEED A SESSION.
// A visitor can read every paste, every tombstone and anyone's list page, and can write
// nothing.
//
// KEYED ON A DERIVED ROLE, not on `Viewer["kind"]`. The viewer type distinguishes `anon`
// from `user`, which cannot tell a member from a moderator — that is `user.isModerator`.
// M1's placeholder table was keyed on the kind, so filling it in here meant deriving the
// third role first. Keying on two values when the design has three actors is how a
// moderator-only action ends up gated by "is signed in".
//
// Enforced in ONE place. `assertCan` is called by every mutation, and the UI's job is to
// avoid offering what the server would refuse — never to be the thing that refuses.
// `capability-denial.spec.ts` calls each mutation directly as an anonymous viewer, because
// a capability enforced only by a hidden button is not enforced.

import "server-only";

import type { Capability, Viewer } from "@/lib/types";

/** §2's three actors. */
export type Role = "visitor" | "member" | "moderator";

export function roleOf(viewer: Viewer): Role {
  if (viewer.kind !== "user") return "visitor";
  return viewer.user.isModerator ? "moderator" : "member";
}

/**
 * Capabilities each role does NOT have.
 *
 * A denial list rather than an allow list, and deliberately: a new capability is then
 * refused to nobody until someone decides who should be refused, which fails open. That
 * is the wrong default in general and the right one here, because the alternative —
 * forgetting to grant a new capability to moderators — breaks moderation silently while a
 * missing denial is caught by the test that enumerates every capability against every
 * role.
 *
 * `retention:extended` appears nowhere below on purpose. The `never` option is kept rare
 * by requiring a written reason, not by requiring a role (§6.3): gating it on permission
 * would make the unbounded choice a privilege, and the reason is what actually makes
 * someone think about it.
 */
const DENIED: Record<Role, readonly Capability[]> = {
  visitor: ["paste:create", "paste:fork", "removal:request", "removal:decide"],
  // A member may ask for their own paste to be removed; they may not decide it. The
  // relationship check in `mayRequestRemoval` is separate and narrower — this says
  // "signed in is enough to ask", that says "about whose paste".
  member: ["removal:decide"],
  moderator: [],
};

export function deniedTo(role: Role): readonly Capability[] {
  return DENIED[role];
}

export function can(viewer: Viewer, capability: Capability): boolean {
  return !DENIED[roleOf(viewer)].includes(capability);
}
