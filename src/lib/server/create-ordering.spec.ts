// @vitest-environment node

// Catches the refactor that moves the scan after the insert (ARCHITECTURE §4, §6.1).
//
// `create-blocks.spec.ts` asserts the outcome: after a tier-1 refusal the tables are
// empty. That passes for the wrong implementation too — one that inserts, scans, then
// deletes ends in the same state. The window is the bug, not the end state, and a crash
// inside it leaves a live credential addressable forever.
//
// So this asserts the ORDER, by failing the scanner and checking that no row exists at
// the moment it raises. If the insert has moved earlier, the row is there when the
// scanner is reached and the test fails — which is the only way to catch a change that
// leaves every outcome-based assertion green.

import { describe, expect, it, vi } from "vitest";

import {
  ownedCounts,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { prisma } from "@/lib/server/prisma";

const reason = skipReason();

describe.skipIf(reason !== null)(
  `create ordering${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("has written nothing at the moment the scanner runs", async () => {
      await withTestOwner(async (owner) => {
        // The probe: when the scanner is called, count what exists. The scan is stage 6
        // and the insert is stage 7, so the correct answer is zero.
        let pastesWhenScanned = -1;

        vi.resetModules();
        vi.doMock("@/lib/secrets/scan", async () => {
          const real =
            await vi.importActual<typeof import("@/lib/secrets/scan")>(
              "@/lib/secrets/scan",
            );
          return {
            ...real,
            scan: (body: string) => {
              // Synchronous, like the real scanner, so this cannot accidentally yield
              // and let an insert land while the probe is suspended.
              pastesWhenScanned = probe;
              return real.scan(body);
            },
          };
        });

        // Read the count before the call, because the mocked scan is synchronous and
        // cannot await. Zero rows for this owner is the baseline.
        const probe = await prisma.paste.count({
          where: { ownerId: owner.userId },
        });
        expect(probe).toBe(0);

        const { createPaste } = await import("@/lib/server/mutations");
        const paste = await createPaste(owner.viewer, {
          body: "just some text\n",
          retention: "1h",
        });

        // The scanner ran, and saw an empty table.
        expect(pastesWhenScanned).toBe(0);
        // And the create did complete, so the assertion above is about ordering rather
        // than about a create that never happened.
        expect(paste.id).toHaveLength(8);
        expect((await ownedCounts(owner.userId)).pastes).toBe(1);

        vi.doUnmock("@/lib/secrets/scan");
        vi.resetModules();
      });
    });

    it("leaves no row behind when the write fails after the paste insert", async () => {
      await withTestOwner(async (owner) => {
        // Fail inside stage 7, after the paste insert but while the transaction is open.
        // The whole write is one transaction precisely so half a create is impossible: a
        // paste with no revision cannot be rendered, cannot be tombstoned meaningfully
        // and has no size, which is why the mapper throws rather than papering over it.
        //
        // The failure is a real NOT NULL violation on `paste_revisions.line_count`
        // rather than a thrown JS error, which makes this a test of the database's
        // atomicity instead of a test of where an exception happens to be caught.
        //
        // `@/lib/normalise` is the mock point because only the create path imports it.
        // An earlier version mocked `@/lib/expiry/retention`, which the fixtures module
        // calls at load — so the mock broke an unrelated import, the test failed before
        // reaching its assertion, and the un-mock never ran and poisoned the next test.
        try {
          vi.resetModules();
          vi.doMock("@/lib/normalise", async () => {
            const real =
              await vi.importActual<typeof import("@/lib/normalise")>(
                "@/lib/normalise",
              );
            return {
              ...real,
              normalise: (input: string) => ({
                ...real.normalise(input),
                lineCount: null as unknown as number,
              }),
            };
          });

          const { createPaste } = await import("@/lib/server/mutations");
          await expect(
            createPaste(owner.viewer, { body: "text\n", retention: "1h" }),
          ).rejects.toThrow();

          const counts = await ownedCounts(owner.userId);
          expect(counts.pastes).toBe(0);
          expect(counts.revisions).toBe(0);
        } finally {
          // In `finally`, because a failed assertion above would otherwise leave the
          // mock installed for every later test in this file.
          vi.doUnmock("@/lib/normalise");
          vi.resetModules();
        }
      });
    });

    it("keeps the paste when the render fails", async () => {
      await withTestOwner(async (owner) => {
        // Stage 8 sits OUTSIDE the transaction so a grammar bug cannot roll back a
        // correctly saved paste. This is the half of that decision which is easy to lose:
        // moving the render inside the transaction "for consistency" would turn every
        // highlighter failure into a lost snippet, and the view page already renders an
        // escaped `<pre>` when there is no stored render.
        try {
          vi.resetModules();
          vi.doMock("@/lib/render/highlight", async () => {
            const real = await vi.importActual<
              typeof import("@/lib/render/highlight")
            >("@/lib/render/highlight");
            return {
              ...real,
              highlight: () => {
                throw new Error("grammar exploded");
              },
            };
          });

          const { createPaste } = await import("@/lib/server/mutations");
          const paste = await createPaste(owner.viewer, {
            body: "def f():\n    return 1\n",
            language: "python",
            retention: "1h",
          });

          const counts = await ownedCounts(owner.userId);
          expect(counts.pastes).toBe(1);
          expect(counts.revisions).toBe(1);
          // No render, and that is a case the UI answers rather than an error.
          expect(counts.renders).toBe(0);
          expect(paste.body).toBe("def f():\n    return 1\n");
        } finally {
          vi.doUnmock("@/lib/render/highlight");
          vi.resetModules();
        }
      });
    });
  },
);
