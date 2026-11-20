/**
 * The paste ids the landing page's screenshots are taken from.
 *
 * IN `src/lib`, NOT `scripts/`, because the landing page imports it too — and the
 * dependency only runs one way: app code must not reach into a scripts folder. The first
 * attempt kept it beside the scripts and imported `../../scripts/shot-subjects.mjs` from
 * `app/page.tsx`. `tsc` accepted that; Next's bundler answered
 * "Module not found: Can't resolve", and `/` served a 500 — a typecheck-clean break that
 * only a request reveals.
 *
 * ITS OWN MODULE so that importing an id does not run a seed. `capture-shots.mts` first
 * imported these straight from `seed-shot-subjects.mts`, which is a script with a top-level
 * `await main()` — so every capture run silently wrote to the database on import. Harmless
 * because the seed is idempotent, and exactly the kind of import side effect that is not
 * harmless the next time.
 *
 * ALL THREE ARE SEEDED, which is the fix for the first version of this file. `LIVE_SUBJECT_ID`
 * used to name `AerfZDG4`, a real row in whoever's development database — so `pnpm shots` died
 * with a 404 on any other machine or after a reset, and PRODUCT.md approves these screenshots
 * on the explicit condition that they are reproducible. It also put a real personal handle,
 * `lbyybl1996`, in the breadcrumb of the hero image on a public marketing page. Demonstration
 * data has to be authored and visibly synthetic.
 */

// EIGHT CHARACTERS, VALID BASE58, for every id below. The first attempt used `ShotLive1`
// and `ShotGone1` — nine characters each — and the pages rendered their content under a
// **404**: `proxy.ts` shape-checks the id and refuses before the page is reached, while the
// page itself looks the row up regardless. A status that disagrees with the body is the one
// outcome §6.3 is built to avoid, and a seed is the only way to create an id that can
// trigger it, since `newPasteId` always produces eight.

/** Live, JavaScript, line numbers on. The hero: what a reader sees after following a link. */
export const LIVE_SUBJECT_ID = "ShotLiv1";

// NO "EXPIRED BUT NOT YET PURGED" SUBJECT. One was seeded and photographed, and nothing
// shipped it: the landing page's claim is that the hash outlives the BYTES, which only the
// purged state demonstrates. A seeded fixture no page renders is the same dead weight as an
// unused asset, so it went with the screenshot.

/**
 * Purged: the bytes are destroyed and the hash survives.
 *
 * THE SECTION ABOUT OUTLIVING THE TEXT NEEDS THIS ONE. Pointed at `ShotExp1`, the page's copy
 * ("the SHA-256 of the bytes that are gone", "the hash outlives the bytes") sat beside a
 * screenshot reading "The bytes are still here until 15 Dec 2026" — the page overclaiming on
 * the exact mechanism that section exists to prove, with the contradiction visible in the
 * evidence it supplied itself.
 */
export const PURGED_SUBJECT_ID = "ShotGon1";

/** The owner every subject shares. Visibly not a person. */
export const SUBJECT_OWNER = "shots-demo";
