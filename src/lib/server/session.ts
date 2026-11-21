// Resolving the Clerk session to a local user row.
//
// SEPARATE FROM viewer.ts, and the split is load bearing rather than tidy. Importing
// `@clerk/nextjs/server` pulls Next's app-router React context into whatever imports it,
// and `viewer.ts` exports `assertCan`, which `mutations.ts` imports, which nearly every
// database test imports. Keeping Clerk here meant the entire suite failed on
// `React.createContext is not a function` in the node environment those tests need.
//
// The same reason `view-route.ts` is separate from `proxy.ts`. A module that touches the
// framework's client runtime should not be on the import path of pure server logic.

import "server-only";

import { cache } from "react";

import { auth, currentUser } from "@clerk/nextjs/server";

import { guestFromCookie } from "@/lib/server/guest";
import { prisma } from "@/lib/server/prisma";
import type { User, Viewer } from "@/lib/types";

/**
 * The current viewer, from Clerk's session.
 *
 * M1 declared this signature and returned a fixture; M10 replaced the body. No call site
 * changed, which is the whole return on Appendix C rule 3 — the `anon` arm has existed
 * since M1 precisely because reads are public (§3) and the view page must render for a
 * signed-out visitor, so the signed-out path was never retrofitted.
 */
export async function getViewer(): Promise<Viewer> {
  const { userId } = await auth();
  if (userId === null || userId === undefined) {
    // NO CLERK SESSION IS NOT THE SAME AS NO IDENTITY SINCE M15. A guest cookie resolves to
    // a real `users` row, so the viewer is `kind: "user"` and everything downstream — the
    // capability table, the owner joins, the removal relationship check, the rate bucket —
    // works without knowing the difference. The Clerk session is checked FIRST so that
    // signing in always wins over a stale guest cookie.
    const guest = await guestFromCookie();
    return guest === null ? { kind: "anon" } : { kind: "user", user: guest };
  }

  return { kind: "user", user: await localUser(userId) };
}

/**
 * The local row mirroring a Clerk user, created on first sign-in.
 *
 * Deduplicated per request: `AppShell`, the page and its children all resolve the viewer,
 * and without this each one is another query. It does not reach `generateMetadata`, which
 * resolves in a separate pass under `cacheComponents` — measured in M8, and the reason
 * `getPasteMeta` exists rather than a cached `getPaste`.
 */
const localUser = cache(async (clerkUserId: string): Promise<User> => {
  const existing = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { username: true, displayName: true, isModerator: true },
  });

  if (existing !== null) {
    return {
      username: existing.username,
      displayName: existing.displayName ?? existing.username,
      isModerator: existing.isModerator,
    };
  }

  return createLocalUser(clerkUserId);
});

/**
 * First sign-in: mint the local row and FREEZE the username.
 *
 * The handle appears in `/list/:username`, a URL that must not rot, so it is ours rather
 * than Clerk's (§2, Appendix G question 3). Re-reading it from Clerk on each request would
 * mean someone renaming themselves in Clerk silently breaks every link anyone saved to
 * their list — so it is written once here and never updated from Clerk again.
 */
async function createLocalUser(clerkUserId: string): Promise<User> {
  const clerkUser = await currentUser();

  const email = clerkUser?.emailAddresses[0]?.emailAddress ?? null;
  const displayName =
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    clerkUser?.username ||
    email?.split("@")[0] ||
    "Someone";

  const base = usernameFrom(clerkUser?.username ?? email ?? clerkUserId);

  // Collisions are real: two people called `alex.smith@` at different domains both want
  // `alex-smith`. Try the plain handle, then suffix — rather than letting the unique index
  // throw and failing the sign-in, which is the first thing a new user would ever see.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const username = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const created = await prisma.user.create({
        data: { clerkUserId, username, displayName, email },
        select: { username: true, displayName: true, isModerator: true },
      });
      return {
        username: created.username,
        displayName: created.displayName ?? created.username,
        isModerator: created.isModerator,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // The clash may be on `clerk_user_id`, not `username` — two concurrent requests for
      // the same new user, which is ordinary on first sign-in because the page and its
      // children all resolve a viewer. Whoever lost the race reads the winner's row.
      const now = await prisma.user.findUnique({
        where: { clerkUserId },
        select: { username: true, displayName: true, isModerator: true },
      });
      if (now !== null) {
        return {
          username: now.username,
          displayName: now.displayName ?? now.username,
          isModerator: now.isModerator,
        };
      }
      // Otherwise the username was taken. Loop and suffix.
    }
  }

  throw new Error(
    `could not mint a username for ${clerkUserId} after 5 attempts; base was "${base}"`,
  );
}

/** A handle that is safe in a URL and recognisable to its owner. */
export function usernameFrom(source: string): string {
  const slug = source
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  // Never empty, and never only punctuation: `/list/` with no handle is a different route,
  // and a blank segment would 404 in a way that looks like the account is broken.
  return slug === "" ? "user" : slug;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "23505" || code === "P2002";
}
