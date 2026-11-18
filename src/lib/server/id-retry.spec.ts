// @vitest-environment node

// The id collision, forced against the real unique index (ARCHITECTURE §1.3).
//
// `ids.spec.ts` tests the retry helper with a synthetic error. This tests that the thing
// Postgres actually raises is the thing the helper recognises — a distinction that has
// bitten before, because the driver's error shape is not the one a hand-written stub
// would guess. A helper that retries on `P2002` while the adapter reports `23505`
// catches nothing, and both tests pass in isolation.

import { describe, expect, it, vi } from "vitest";

import {
  ownedCounts,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { prisma } from "@/lib/server/prisma";

const reason = skipReason();

describe.skipIf(reason !== null)(
  `id collisions${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("still saves the paste when the first id is already taken", async () => {
      await withTestOwner(async (owner) => {
        // A real paste to collide with, created the normal way.
        const { createPaste } = await import("@/lib/server/mutations");
        const first = await createPaste(owner.viewer, {
          body: "the incumbent\n",
          retention: "1h",
        });

        try {
          vi.resetModules();
          // Hand out the taken id once, then real ones. This is the collision the
          // insert-and-retry exists for, and it exercises the actual unique index rather
          // than a stubbed rejection.
          vi.doMock("@/lib/ids", async () => {
            const real =
              await vi.importActual<typeof import("@/lib/ids")>("@/lib/ids");
            let calls = 0;
            return {
              ...real,
              newPasteId: () => {
                calls += 1;
                return calls === 1 ? first.id : real.newPasteId();
              },
            };
          });

          const mod = await import("@/lib/server/mutations");
          const second = await mod.createPaste(owner.viewer, {
            body: "the challenger\n",
            retention: "1h",
          });

          // Saved, with a different id, and the incumbent untouched.
          expect(second.id).not.toBe(first.id);
          expect(second.id).toHaveLength(8);
          expect(second.body).toBe("the challenger\n");

          const incumbent = await prisma.paste.findUniqueOrThrow({
            where: { id: first.id },
            include: { revisions: true },
          });
          // The collision must not have overwritten the first paste — which is what an
          // upsert would have done, silently, and is the reason this is an insert.
          expect(incumbent.revisions[0].bodyText).toBe("the incumbent\n");

          const counts = await ownedCounts(owner.userId);
          expect(counts.pastes).toBe(2);
          // And no orphan from the failed attempt: the losing insert was inside the
          // transaction, so it rolled back whole.
          expect(counts.revisions).toBe(2);
        } finally {
          vi.doUnmock("@/lib/ids");
          vi.resetModules();
        }
      });
    });

    it("recognises the error Postgres actually raises", async () => {
      await withTestOwner(async (owner) => {
        const { createPaste } = await import("@/lib/server/mutations");
        const first = await createPaste(owner.viewer, {
          body: "incumbent\n",
          retention: "1h",
        });

        // Insert the same id directly and capture what comes back, so the assertion is
        // about the driver's real error rather than about what the helper expects.
        const duplicate = await prisma.paste
          .create({
            data: {
              id: first.id,
              ownerId: owner.userId,
              language: "plaintext",
              languageSource: "fallback",
              retentionCode: "1h",
              state: "live",
              createdVia: "web",
            },
          })
          .then(
            () => null,
            (error: unknown) => error,
          );

        expect(duplicate).not.toBeNull();
        const code = (duplicate as { code?: unknown }).code;
        // One of the two the helper handles. If Prisma ever reports something else, this
        // fails here rather than turning every collision into a 500 in production.
        expect(["23505", "P2002"]).toContain(code);
      });
    });
  },
);
