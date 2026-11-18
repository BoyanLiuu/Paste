// How a stored render is addressed.
//
// Appendix D keys `paste_renders` on (revision_id, theme), so the phase-1 lookup key
// carries both. Keying on the revision alone would work until a second theme existed
// and then silently return the wrong markup — the seam drift Appendix C exists to stop.
//
// These are pure formatters, deliberately not in the service module: a synchronous
// helper there would need its own exemption in every service-contract assertion.

/** The theme Shiki renders with. One for now; the key is ready for a second. */
export const DEFAULT_THEME = "paste";

/** Phase 1's stand-in for a revision's primary key. Phase 2 has real ids and this
 *  disappears; callers only ever pass the result along, so it is opaque to them. */
export function revisionKey(pasteId: string, revisionNo: number): string {
  return `${pasteId}:${revisionNo}`;
}

/** The composite key a render is stored under. */
export function renderKey(revisionId: string, theme = DEFAULT_THEME): string {
  return `${revisionId}:${theme}`;
}
