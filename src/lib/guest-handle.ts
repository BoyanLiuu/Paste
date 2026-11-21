// Whether a username belongs to a guest (M15).
//
// A MODULE THAT IMPORTS NOTHING, on purpose, exactly as `fork-problem.ts` does and for the
// same reason. This predicate is needed by `paste-view.tsx` to decide whether to render an
// owner breadcrumb — and `paste-view.tsx` is on the view route, whose module graph N2 and
// N11 both constrain. Keeping it in `server/guest.ts` would drag `prisma` and
// `next/headers` onto the hot read path to answer a question about a string.
//
// `view-route-imports.spec.ts` would not have caught that: its forbidden list names `shiki`
// and the Clerk client entry point, not Prisma. The guard is a list of known mistakes rather
// than a rule, which is why the shape of the dependency still has to be thought about.

/**
 * Whether this username belongs to a guest.
 *
 * BY PREFIX, which is a compromise worth naming. The authoritative test is
 * `guest_token IS NOT NULL`, and that is a query — which the view page would have to make
 * for every paste, on the hot path, to decide whether to print a link. The prefix is
 * reserved instead: `usernameFrom` derives account handles from Clerk identifiers, and
 * `mintGuest` is the only writer of this shape.
 *
 * If someone ever does register a `guest-…` handle, their list reads as empty and their
 * pastes show no owner — a loss of function rather than a leak, which is the correct
 * direction for this to fail in.
 */
export function isGuestUsername(username: string): boolean {
  return username.startsWith("guest-");
}

/**
 * A username as a reader should see it.
 *
 * HERE RATHER THAN IN ONE COMPONENT, because it is needed by two and I missed the second
 * twice. The view page names an owner in four places — the breadcrumb, the metadata row,
 * the lifecycle timeline and a fork's provenance — and the TOMBSTONE names one too, on the
 * 410 receipt. Guarding the first three left a guest's handle printed in full on the
 * receipt of their own expired paste, which is reachable by anyone: create anonymously with
 * an hour's retention and wait.
 *
 * A guest has no account, so there is no handle worth printing — and a real one is enough
 * to construct `/list/guest-…` by hand, which is the URL the breadcrumb stops linking to.
 */
export function shownOwner(username: string): string {
  return isGuestUsername(username) ? "No account" : username;
}
