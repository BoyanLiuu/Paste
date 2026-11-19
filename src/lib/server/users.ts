// Resolving a viewer to a database user row.
//
// A gap the plan does not name: M7 writes pastes, every paste needs an `owner_id`, and
// until M10 the viewer is a fixture object with a username and no row anywhere. The
// create path cannot proceed without bridging that.
//
// Upsert on username, on demand. Two alternatives were worse:
//
//   - A separate seed script. A fresh clone's first create then fails with a foreign-key
//     violation until someone remembers to run it, and the error names `owner_id` rather
//     than the missing step.
//   - Creating the row in the create transaction. It would roll back with a failed
//     create, so the next attempt recreates it — work repeated for no reason, inside the
//     transaction whose length matters most.
//
// Additive and idempotent, which is the standing rule for anything that writes to this
// shared schema (Appendix B): never TRUNCATE, never `migrate reset`.

import "server-only";

import { USERS } from "@/lib/fixtures";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

/**
 * The user row for a viewer, created if absent.
 *
 * SINCE M10 THE CREATE ARM IS A TEST-ONLY PATH. `getViewer()` mints the local row on first
 * sign-in, with `clerk_user_id` set, so a real session always arrives here with its row
 * already present and this is a lookup. What still needs the create arm is a synthetic
 * viewer — the test harness builds them with no Clerk user behind them — and keeping it
 * additive means those tests do not need a separate seeding step.
 *
 * It deliberately does not write `clerk_user_id`: a row minted from a synthetic viewer has
 * no Clerk user, and guessing one would create a row that `getViewer` would later match to
 * the wrong person.
 *
 * `username` is the natural key, not `clerkUserId`: the handle appears in
 * `/list/:username` and is ours and frozen (§3), while `clerk_user_id` is nullable and
 * unused until M10. Keying on Clerk's id now would mean every phase-2 row needs
 * rewriting when auth lands.
 */
export async function userIdFor(viewer: Viewer): Promise<string> {
  if (viewer.kind !== "user") {
    // Reads are public; writes are not. M10's DENIED table refuses `paste:create` for
    // anon before this is reached, so arriving here means the capability gate was
    // bypassed rather than that an anonymous create should be invented a row.
    throw new Error("Cannot resolve a user row for an anonymous viewer.");
  }

  const { username, displayName, isModerator } = viewer.user;

  const user = await prisma.user.upsert({
    where: { username },
    create: { username, displayName, isModerator },
    // Deliberately empty. The fixture's `displayName` is not authoritative over a row
    // that may have been edited, and an update here would silently revert a real change
    // on every request.
    update: {},
    select: { id: true },
  });

  return user.id;
}

/** Usernames the fixtures reference, for the additive seed. */
export const SEED_USERNAMES = Object.keys(USERS);

/**
 * Insert every fixture user that is missing, and change nothing that exists.
 *
 * `skipDuplicates` rather than a delete-and-recreate: dev and production share this
 * schema, so a seed that removes rows first is a seed that can destroy live data.
 */
export async function seedUsers(): Promise<{ created: number }> {
  const result = await prisma.user.createMany({
    data: Object.values(USERS).map((user) => ({
      username: user.username,
      displayName: user.displayName,
      isModerator: user.isModerator,
    })),
    skipDuplicates: true,
  });

  return { created: result.count };
}
