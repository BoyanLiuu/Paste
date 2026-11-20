/**
 * The paste ids the landing page's screenshots are taken from.
 *
 * ITS OWN MODULE so that importing an id does not run a seed. `capture-shots.mts` first
 * imported this constant straight from `seed-shot-subjects.mts`, which is a script with a
 * top-level `await main()` — so every capture run silently wrote to the database on
 * import. Harmless here because the seed is idempotent, and exactly the kind of import
 * side effect that is not harmless the next time.
 */

/** Live, JavaScript, line numbers on. A real row in the development database. */
export const LIVE_SUBJECT_ID = "AerfZDG4";

/** Expired, written by `pnpm shots:seed` because no honest one exists in the database. */
export const EXPIRED_SUBJECT_ID = "ShotExp1";
