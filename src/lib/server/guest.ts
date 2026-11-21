import "server-only";

import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { recordIn } from "@/lib/audit";
import { prisma } from "@/lib/server/prisma";
import type { User } from "@/lib/types";

// Creating a paste without an account (ARCHITECTURE §3, M15).
//
// A GUEST IS A `users` ROW WITH `clerk_user_id IS NULL`, which the init migration already
// described as a legal state. That choice is what keeps this module small: because a guest
// is a real user row, `pastes.owner_id` stays NOT NULL, every owner join is untouched, the
// removal-request relationship check still works, the audit log gets a real actor,
// `rate_buckets` gets a row per guest for free, and `roleOf` maps a guest to `member` — so
// the capability table needs no change at all.
//
// WHAT A GUEST GETS, AND DOES NOT. Retention is identical to an account's, including
// `never` (the user's decision, 20 Nov 2026) — the written reason is what keeps that option
// rare, not a role. The size ceiling is lower: `GUEST_MAX_BYTES` below.

/** How long a guest's cookie, and therefore their claim on their own pastes, lasts. */
const COOKIE_DAYS = 30;

export const GUEST_COOKIE = "paste_guest";

/**
 * The size ceiling for a paste created without an account.
 *
 * `TRUNCATE_BYTES` RATHER THAN A ROUND NUMBER. Two megabytes is the existing line in §6.2
 * where a paste stops being a page and becomes a download: above it the view page renders
 * the first 500 lines and points at `/dl`. So this cap says something the codebase already
 * means — a guest can create anything that reads as a page — instead of naming an arbitrary
 * figure. An account keeps the full 25 MB.
 *
 * It is also the whole abuse story for size. Retention parity means a guest paste can live
 * forever, so "the reward is small because it expires" no longer applies and the ceiling is
 * what is left. Raising it is one constant; raising it to 25 MB makes anonymous creation a
 * free unbounded file host, which is the thing to think about rather than the number.
 */
export { TRUNCATE_BYTES as GUEST_MAX_BYTES } from "@/lib/render/thresholds";

/**
 * The guest this request belongs to, or null.
 *
 * READ-ONLY, AND THAT IS A FRAMEWORK CONSTRAINT RATHER THAN A CHOICE. Next refuses a cookie
 * write outside a Server Action or a Route Handler, and `getViewer` runs in render paths —
 * so this cannot mint. `mintGuest` exists separately and `/api/pastes` calls it, which also
 * means a guest row is only ever created by someone actually trying to save something, not
 * by anyone who loads a page.
 */
export async function guestFromCookie(): Promise<User | null> {
  const token = (await cookies()).get(GUEST_COOKIE)?.value;
  if (token === undefined || token === "") return null;

  return guestFromCookieFor(token);
}

/**
 * The guest a token resolves to, without reading the request.
 *
 * SPLIT OUT SO IT IS TESTABLE. `cookies()` throws "called outside a request scope" in the
 * unit environment, which would have left the privilege decision below — that a guest is
 * never a moderator — asserted by nothing but a comment.
 */
export async function guestFromCookieFor(token: string): Promise<User | null> {
  const row = await prisma.user.findUnique({
    where: { guestToken: token },
    select: { username: true, displayName: true },
  });

  // A token that matches nothing resolves to anon rather than throwing. Reachable without
  // anyone misbehaving: the claim clears the token while the cookie lives for a month, so
  // this is the state of every browser that has already claimed.
  if (row === null) return null;

  return {
    username: row.username,
    displayName: row.displayName ?? row.username,
    // HARDCODED `false`, NOT READ FROM THE ROW. An earlier version selected
    // `is_moderator` and passed it through, reasoning that a row carrying the flag should
    // not be silently stripped of it — which is backwards for a privilege. This identity
    // rests on nothing but possession of a cookie, so it must not be able to carry the one
    // capability that can destroy other people's pastes. If a guest row ever does acquire
    // the flag, the right outcome is that it does nothing.
    isModerator: false,
  };
}

/**
 * Create a guest, set the cookie, and return the user it resolves to.
 *
 * CALLED FROM A ROUTE HANDLER ONLY, for the cookie-write reason above.
 *
 * `SameSite=Lax`, NOT `Strict`. Clerk's sign-in bounces the browser through its own origin
 * and back, and `Strict` withholds the cookie on that return navigation — so M16's claim
 * would silently never fire, after passing every local test that never leaves the origin.
 * This is the single most likely thing in the guest flow to be got wrong, which is why it
 * is asserted in `guest.spec.ts` rather than left to a comment.
 */
export async function mintGuest(request: Request): Promise<User> {
  const token = randomBytes(32).toString("base64url");

  const row = await prisma.user.create({
    data: {
      guestToken: token,
      // A handle that reads as what it is. `/list/:username` answers 404 for these
      // (M15's enumeration fix), so it is an internal label rather than a public one —
      // but it is still the `username` column, so it has to be unique and stable.
      // 16 HEX CHARACTERS, NOT 10. `username` is UNIQUE, so a collision is not a cosmetic
      // problem — it is an unhandled constraint violation that answers 500 to someone
      // trying to save. 40 bits put the birthday bound around a million guests, which is a
      // number this could plausibly reach; 64 bits does not.
      username: `guest-${randomBytes(8).toString("hex")}`,
      displayName: "Guest",
    },
    select: { username: true, displayName: true },
  });

  (await cookies()).set(GUEST_COOKIE, token, {
    httpOnly: true,
    // FROM THE REQUEST'S PROTOCOL, NOT `NODE_ENV`. The usual idiom — `NODE_ENV ===
    // "production"` — sets `Secure` on the production build, which is correct on Vercel and
    // wrong the moment that build is served over plain HTTP. The e2e suite does exactly
    // that: `pnpm build && pnpm start` on `http://127.0.0.1`, where the browser silently
    // DROPS a Secure cookie. The symptom was a successful save landing back on an empty
    // form, because `?saved=` resolved to a viewer who no longer owned anything.
    //
    // `x-forwarded-proto` first, because behind a proxy that terminates TLS the origin
    // itself sees HTTP — which is every request on Vercel.
    secure: isHttps(request),
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_DAYS * 24 * 60 * 60,
  });

  return {
    username: row.username,
    displayName: row.displayName ?? row.username,
    // Never a moderator, for the reason `guestFromCookie` sets out.
    isModerator: false,
  };
}

// `isGuestUsername` LIVES IN `lib/guest-handle.ts`, not here, and is re-exported for
// callers that already import this module. The view page needs the predicate and must not
// import `prisma` or `next/headers` to get it — see that file's header.
export { isGuestUsername } from "@/lib/guest-handle";

/** Whether the browser reached us over TLS, directly or through a terminating proxy. */
function isHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded !== null) return forwarded.split(",")[0].trim() === "https";

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    // An unparseable URL is not a reason to drop the cookie's protection; default to on.
    return true;
  }
}

/** How many pastes this guest cookie still owns, for the claim prompt. */
export async function guestPasteCount(token: string): Promise<number> {
  const guest = await prisma.user.findUnique({
    where: { guestToken: token },
    select: { id: true },
  });
  if (guest === null) return 0;

  return prisma.paste.count({ where: { ownerId: guest.id } });
}

/**
 * Move a guest's pastes into a signed-in account (M16).
 *
 * THE REVISIONS DO NOT MOVE, AND THE DATABASE IS WHAT TAUGHT ME THAT. The first version
 * reassigned `paste_revisions.created_by` alongside the paste and was refused outright:
 *
 *   P0001  paste_revisions: revision … is immutable (attempted to change: created_by)
 *
 * The immutability trigger is right and the design was wrong. §6.3 makes a revision
 * unrewritable except for `purged_at`, and a revision's author is a historical fact: a
 * guest DID create it. Rewriting that would be the audit trail telling a more convenient
 * story than what happened, in the one record the product asks people to trust.
 *
 * So a claim moves OWNERSHIP, which is a property of the paste, and leaves AUTHORSHIP,
 * which is a property of the revision. The view page already renders the latter as
 * "No account" via `shownOwner` — and that now reads as the truth rather than a redaction.
 *
 * CONSEQUENTLY THE GUEST ROW SURVIVES, because the revisions still reference it. Its
 * `guest_token` is cleared instead, which is what actually matters: the row becomes a
 * historical actor that no cookie can resolve to, so a stale cookie cannot turn the person
 * back into a guest on their next visit. `users_guest_xor_account` permits a row with
 * neither a token nor a Clerk id, which the migration records as deliberate — this is the
 * state it was deliberate for.
 *
 * ONE TRANSACTION, AND IDEMPOTENT: run it twice and the second pass finds no row with that
 * token and does nothing. The only thing between the two runs is a double-clicked button.
 *
 * Returns how many pastes moved, so the caller can say so rather than guess.
 */
export async function claimGuestPastes(
  accountUserId: string,
  token: string,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const guest = await tx.user.findUnique({
      where: { guestToken: token },
      select: { id: true, username: true },
    });

    // Already claimed, or a cookie outliving its token. Both are ordinary.
    if (guest === null || guest.id === accountUserId) return 0;

    const pastes = await tx.paste.findMany({
      where: { ownerId: guest.id },
      select: { id: true },
    });

    await tx.paste.updateMany({
      where: { ownerId: guest.id },
      data: { ownerId: accountUserId },
    });

    // ONE AUDIT ROW PER PASTE. The payload carries the handle, which is the only place the
    // correspondence between a guest and an account is ever written down — without it the
    // trail says a paste changed owner and nothing says from what.
    for (const paste of pastes) {
      await recordIn(tx, {
        action: "paste.claimed",
        subjectType: "paste",
        subjectId: paste.id,
        actorId: accountUserId,
        payload: { from: guest.username },
      });
    }

    // The token, not the row. See the note above.
    await tx.user.update({
      where: { id: guest.id },
      data: { guestToken: null },
    });

    return pastes.length;
  });
}
