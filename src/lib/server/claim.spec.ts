// @vitest-environment node

// Claiming a guest's pastes at sign-in (ARCHITECTURE §3, M16).
//
// WHY A UNIT TEST AND NOT AN E2E ONE. The claim needs a real Clerk session on one side and a
// guest cookie on the other, and there is no test credential — the same gap that keeps two
// receipt assertions skipped. So the transaction is exercised directly, which is where the
// failure modes live anyway: a half-moved paste, a foreign key left pointing at a deleted
// row, and a second click doing it twice.

import { describe, expect, it } from "vitest";

import { claimGuestPastes, guestPasteCount } from "@/lib/server/guest";
import { guestFromCookieFor } from "@/lib/server/guest";
import { prisma } from "@/lib/server/prisma";
import { skipReason } from "@/lib/server/create-test-harness";

const reason = skipReason();

/** A guest with `count` pastes, each with a revision, as the create path leaves them. */
async function seedGuest(count: number) {
  const token = `test-token-${crypto.randomUUID()}`;
  const guest = await prisma.user.create({
    data: {
      guestToken: token,
      username: `guest-${crypto.randomUUID().slice(0, 10)}`,
      displayName: "Guest",
    },
    select: { id: true, username: true },
  });

  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `T${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}`;
    await prisma.paste.create({
      data: {
        id,
        ownerId: guest.id,
        language: "plaintext",
        languageSource: "explicit",
        retentionCode: "1d",
        expiresAt: new Date(Date.now() + 86_400_000),
        purgeAfter: new Date(Date.now() + 31 * 86_400_000),
        state: "live",
        createdVia: "web",
        revisions: {
          create: {
            revisionNo: 1,
            byteSize: 5,
            lineCount: 1,
            sha256: "b".repeat(64),
            bodyText: "hello",
            reason: "original",
            scanState: "complete",
            createdById: guest.id,
          },
        },
      },
    });
    ids.push(id);
  }

  return { token, guest, ids };
}

/** A signed-in account to claim into. */
async function seedAccount() {
  return prisma.user.create({
    data: {
      clerkUserId: `user_${crypto.randomUUID()}`,
      username: `acct-${crypto.randomUUID().slice(0, 8)}`,
      displayName: "Account",
    },
    select: { id: true, username: true },
  });
}

async function cleanUp(userIds: string[]) {
  for (const id of userIds) {
    const pastes = await prisma.paste.findMany({
      where: { ownerId: id },
      select: { id: true },
    });
    for (const p of pastes) {
      await prisma.auditLog.deleteMany({ where: { subjectId: p.id } });
    }
    await prisma.auditLog.deleteMany({ where: { actorId: id } });
    await prisma.paste.deleteMany({ where: { ownerId: id } });
    await prisma.user.deleteMany({ where: { id } });
  }
}

describe.skipIf(reason !== null)(
  `claimGuestPastes${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("moves ownership and leaves authorship alone", async () => {
      // THE DATABASE REFUSED MY FIRST DESIGN, which also moved
      // `paste_revisions.created_by`:
      //
      //   P0001  paste_revisions: revision … is immutable (attempted to change: created_by)
      //
      // The trigger is right. §6.3 makes a revision unrewritable, and its author is a
      // historical fact — a guest did create it. So this asserts the split: ownership is a
      // property of the paste and moves; authorship is a property of the revision and does
      // not. The view page renders the latter as "No account", which is now the truth.
      const { token, guest, ids } = await seedGuest(2);
      const account = await seedAccount();

      try {
        const moved = await claimGuestPastes(account.id, token);
        expect(moved).toBe(2);

        expect(
          await prisma.paste.count({ where: { ownerId: account.id } }),
        ).toBe(2);

        // Authorship stayed with the guest, and that is deliberate.
        expect(
          await prisma.revision.count({
            where: { createdById: guest.id, pasteId: { in: ids } },
          }),
        ).toBe(2);
      } finally {
        await cleanUp([account.id, guest.id]);
      }
    });

    it("clears the token so a stale cookie cannot resolve back to the guest", async () => {
      // THE ROW SURVIVES, because the revisions still reference it — so what has to go is
      // the credential, not the record. Leaving the token would turn the person back into a
      // guest on their next visit, holding a cookie for pastes that are now in their
      // account.
      const { token, guest } = await seedGuest(1);
      const account = await seedAccount();

      try {
        await claimGuestPastes(account.id, token);

        const row = await prisma.user.findUniqueOrThrow({
          where: { id: guest.id },
          select: { guestToken: true, clerkUserId: true },
        });
        expect(row.guestToken).toBeNull();

        // Neither a token nor a Clerk id: the historical-actor state the migration's
        // `users_guest_xor_account` CHECK was written to permit.
        expect(row.clerkUserId).toBeNull();

        expect(
          await prisma.user.findUnique({ where: { guestToken: token } }),
        ).toBeNull();
      } finally {
        await cleanUp([account.id, guest.id]);
      }
    });

    it("records what each paste was claimed from", async () => {
      // The guest handle is about to stop existing, so the audit row is the only place the
      // correspondence is ever written down. Without the payload the trail says a paste
      // changed owner and nothing says from what — the question a reader is asking.
      const { token, guest, ids } = await seedGuest(1);
      const account = await seedAccount();

      try {
        await claimGuestPastes(account.id, token);

        const entry = await prisma.auditLog.findFirst({
          where: { subjectId: ids[0], action: "paste.claimed" },
        });
        expect(entry).not.toBeNull();
        expect(entry!.actorId).toBe(account.id);
        expect(entry!.payload).toMatchObject({ from: guest.username });
      } finally {
        await cleanUp([account.id, guest.id]);
      }
    });

    it("is a no-op the second time, because a button gets double-clicked", async () => {
      const { token, guest } = await seedGuest(1);
      const account = await seedAccount();

      try {
        expect(await claimGuestPastes(account.id, token)).toBe(1);
        // The guest row is gone, so the second pass finds nothing and must not throw.
        expect(await claimGuestPastes(account.id, token)).toBe(0);
        expect(
          await prisma.paste.count({ where: { ownerId: account.id } }),
        ).toBe(1);
      } finally {
        await cleanUp([account.id, guest.id]);
      }
    });

    it("claims nothing for a token that matches no guest", async () => {
      // Reachable without anyone misbehaving: the cookie outlives the row once a claim has
      // run, so this is the state of every browser that has already claimed.
      const account = await seedAccount();
      try {
        expect(await claimGuestPastes(account.id, "no-such-token")).toBe(0);
      } finally {
        await cleanUp([account.id]);
      }
    });

    it("never resolves a guest as a moderator, whatever the row says", async () => {
      // A PRIVILEGE BOUNDARY, so it is asserted rather than reasoned about. A guest identity
      // rests on nothing but possession of a cookie; `removal:decide` destroys other
      // people's bytes irreversibly. An earlier version passed `is_moderator` through from
      // the row — so a guest row that acquired the flag would have carried it.
      const { token, guest } = await seedGuest(0);
      await prisma.user.update({
        where: { id: guest.id },
        data: { isModerator: true },
      });

      try {
        const resolved = await guestFromCookieFor(token);
        expect(resolved).not.toBeNull();
        expect(resolved!.isModerator).toBe(false);
      } finally {
        await cleanUp([guest.id]);
      }
    });

    it("counts what the prompt is about to offer", async () => {
      const { token, guest } = await seedGuest(3);
      const account = await seedAccount();
      try {
        expect(await guestPasteCount(token)).toBe(3);
        expect(await guestPasteCount("no-such-token")).toBe(0);
      } finally {
        await cleanUp([account.id, guest.id]);
      }
    });
  },
);
