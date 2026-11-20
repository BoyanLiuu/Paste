// @vitest-environment node

// The service's read surface, against real rows.
//
// Pagination mechanics live in `keyset-cursor.spec.ts`; this file covers what that one
// does not — owner scoping, the render lookup's compound key, the raw body, and the
// summary counts. Rewritten at M8: it used to assert against `deepika`'s fixture pastes,
// which no longer exist in the database, so every assertion here now seeds what it needs.

import { describe, expect, it } from "vitest";

import { THEME_NAME } from "@/lib/render/highlight";
import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import {
  getPaste,
  getPasteMeta,
  getRaw,
  getRender,
  getRenderForPaste,
  listPastes,
  PAGE_SIZE,
  pasteSummary,
} from "@/lib/server/paste-service";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

const VIEWER: Viewer = { kind: "anon" };
const reason = skipReason();

describe.skipIf(reason !== null)(
  `listPastes${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("gives a stranger an empty page rather than everyone's pastes", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, [{}, {}, {}]);

        // The scoping bug that matters: a missing `owner` clause returns the whole table,
        // and the page looks right to whoever is testing with one account.
        const mine = await listPastes(VIEWER, owner.username);
        expect(mine.total).toBe(3);

        const stranger = await listPastes(VIEWER, "nobody-by-this-name");
        expect(stranger.items).toEqual([]);
        expect(stranger.total).toBe(0);
      });
    });

    it("matches the title, the id and the language, but never the body", async () => {
      await withTestOwner(async (owner) => {
        const [withTitle] = await seedPastes(owner.userId, [
          { title: "deploy notes", language: "yaml", body: "secretword\n" },
          { title: "something else", language: "python" },
        ]);

        expect(
          (await listPastes(VIEWER, owner.username, { query: "deploy" })).items,
        ).toHaveLength(1);
        expect(
          (await listPastes(VIEWER, owner.username, { query: "yaml" })).items,
        ).toHaveLength(1);
        expect(
          (await listPastes(VIEWER, owner.username, { query: withTitle }))
            .items,
        ).toHaveLength(1);

        // Searching bodies is a separate feature with its own privacy question
        // (Appendix A). Matching them here would make every paste's content queryable by
        // anyone who can reach the list.
        expect(
          (await listPastes(VIEWER, owner.username, { query: "secretword" }))
            .items,
        ).toEqual([]);
      });
    });

    it("combines a filter and a search instead of letting one cancel the other", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, [
          { title: "deploy alpha", expiresInMinutes: 60 },
          { title: "deploy beta", expiresInMinutes: -60 },
        ]);

        // The bug this catches shipped and was found in review. `liveWhere` contributes
        // an `OR` and so does the search; the where-clause was built with object spreads,
        // so the second `OR` silently replaced the first and the expiry check vanished.
        // This query listed the expired paste.
        const page = await listPastes(VIEWER, owner.username, {
          filter: "live",
          query: "deploy",
        });

        expect(page.items).toHaveLength(1);
        expect(page.items[0].title).toBe("deploy alpha");
      });
    });

    it("keeps the search on page two", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, [
          ...Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
            minutesAgo: i,
            title: "keep me",
          })),
          ...Array.from({ length: 20 }, (_, i) => ({
            minutesAgo: 500 + i,
            title: "other",
          })),
        ]);

        // The same collision, one layer down: the keyset seek also contributes an `OR`,
        // so paging a searched list dropped the search and page two filled up with rows
        // that never matched. Invisible on page one, which is where anyone would look.
        const first = await listPastes(VIEWER, owner.username, {
          query: "keep",
        });
        expect(first.total).toBe(PAGE_SIZE + 5);
        expect(first.next).not.toBeNull();

        const second = await listPastes(VIEWER, owner.username, {
          query: "keep",
          cursor: first.next!,
        });
        expect(second.items).toHaveLength(5);
        for (const paste of second.items) {
          expect(paste.title).toBe("keep me");
        }
      });
    });

    it("separates live from gone by the clock, not by the state column", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, [
          // Lapsed, but `state` still says live — the sweeper has not run. This is the
          // case §6.3 is about, and the filter has to agree with the view page.
          { expiresInMinutes: -1, state: "live" },
          { expiresInMinutes: 60, state: "live" },
          { expiresInMinutes: null },
        ]);

        const live = await listPastes(VIEWER, owner.username, {
          filter: "live",
        });
        const gone = await listPastes(VIEWER, owner.username, {
          filter: "gone",
        });

        // Two live: the future-dated one and the never-expiring one.
        expect(live.total).toBe(2);
        expect(gone.total).toBe(1);
        expect(gone.items[0].state).toBe("live");
      });
    });
  },
);

describe.skipIf(reason !== null)(
  `pasteSummary${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("counts the whole collection, not one page", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(owner.userId, [
          { expiresInMinutes: -1 },
          { expiresInMinutes: -1 },
          { expiresInMinutes: 60 },
          { expiresInMinutes: null },
        ]);

        const summary = await pasteSummary(VIEWER, owner.username);
        // The tabs lied when they were derived from a page: "Gone 0" while two gone
        // pastes sat further down the list.
        expect(summary.all).toBe(4);
        expect(summary.live).toBe(2);
        expect(summary.gone).toBe(2);
        expect(summary.bytes).toBeGreaterThan(0);
      });
    });

    it("reports zero for someone with nothing rather than failing", async () => {
      const summary = await pasteSummary(VIEWER, "nobody-by-this-name");
      expect(summary).toEqual({ all: 0, live: 0, gone: 0, bytes: 0 });
    });
  },
);

describe.skipIf(reason !== null)(
  `getRender${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("keys on the theme as well as the revision", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{}]);
        const revision = await prisma.revision.findFirstOrThrow({
          where: { pasteId: id },
          select: { id: true },
        });
        await prisma.render.create({
          data: {
            revisionId: revision.id,
            theme: THEME_NAME,
            html: "<pre>stored</pre>",
          },
        });

        await expect(getRender(revision.id)).resolves.toContain("stored");
        // A lookup ignoring the theme would return this markup for every theme, so the
        // first theme change would serve the wrong generation of HTML everywhere.
        await expect(
          getRender(revision.id, "a-theme-nobody-rendered"),
        ).resolves.toBeNull();
      });
    });

    it("returns null when nothing was rendered", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{}]);

        // A legitimate answer, not an error: above the §6.2 threshold there is never a
        // render, and the view page's escaped fallback is a real rendering path. M7's
        // save-time render is also allowed to fail without losing the paste.
        await expect(getRenderForPaste(VIEWER, id)).resolves.toBeNull();
      });
    });

    it("follows the head revision rather than the first one", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{}]);
        const first = await prisma.revision.findFirstOrThrow({
          where: { pasteId: id },
          select: { id: true, createdById: true },
        });

        // A second revision, as a supersession would create. Its render is the one a
        // reader must get; serving revision 1's markup would show the superseded text.
        const second = await prisma.revision.create({
          data: {
            pasteId: id,
            revisionNo: 2,
            byteSize: 5,
            lineCount: 1,
            sha256: "b".repeat(64),
            bodyText: "newer",
            reason: "redaction",
            createdById: first.createdById,
          },
          select: { id: true },
        });

        await prisma.render.create({
          data: {
            revisionId: first.id,
            theme: THEME_NAME,
            html: "<pre>old</pre>",
          },
        });
        await prisma.render.create({
          data: {
            revisionId: second.id,
            theme: THEME_NAME,
            html: "<pre>new</pre>",
          },
        });

        await expect(getRenderForPaste(VIEWER, id)).resolves.toContain("new");
        await expect(getRaw(VIEWER, id)).resolves.toBe("newer");
      });
    });
  },
);

describe.skipIf(reason !== null)(
  `getPaste${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("returns the row whatever its state, leaving the verdict to the caller", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [
          { expiresInMinutes: -60 },
        ]);

        // Deliberately not null. If this filtered expired pastes out, the view page could
        // not tell a lapsed paste from one that never existed — and the whole point of
        // §6.3 is that those get different answers, 410 and 404.
        const paste = await getPaste(VIEWER, id);
        expect(paste).not.toBeNull();
        expect(paste!.id).toBe(id);
      });
    });

    it("returns null for an id no paste has ever had", async () => {
      await expect(getPaste(VIEWER, "zzzzzzzz")).resolves.toBeNull();
    });

    it("refuses a malformed id even when a row is stored under it", async () => {
      // THE BUG: `view-route.ts` shape-checks the id and answers 404, and this function
      // did not — so a paste stored under a malformed id served its content underneath
      // that 404. A status contradicting its own body is what §6.3 exists to prevent.
      //
      // Reached in practice on 19 Nov 2026 by a seed script naming two subjects with NINE
      // characters. `newPasteId` only ever produces eight, so a row like this one has to be
      // written deliberately — which is exactly why the row is written here rather than the
      // test settling for "a malformed id returns null", an assertion a missing row would
      // satisfy on its own and which would still pass with the guard deleted.
      await withTestOwner(async (owner) => {
        const malformed = "ShotLive1"; // nine characters

        await prisma.paste.create({
          data: {
            id: malformed,
            ownerId: owner.userId,
            language: "plaintext",
            languageSource: "explicit",
            retentionCode: "1d",
            expiresAt: new Date(Date.now() + 86_400_000),
            purgeAfter: new Date(Date.now() + 31 * 86_400_000),
            state: "live",
            createdVia: "web",
            // WITH A REVISION, which is the difference between this test proving the guard
            // and passing for the wrong reason. Measured: without a revision the reverted
            // guard made `toPaste` throw "has no revisions", so the assertion went green on
            // a crash rather than on the defect. With one, the reverted guard returns a
            // complete Paste — content the proxy has already answered 404 for.
            revisions: {
              create: {
                revisionNo: 1,
                byteSize: 11,
                lineCount: 1,
                sha256: "a".repeat(64),
                bodyText: "hello there",
                reason: "original",
                scanState: "complete",
                createdById: owner.userId,
              },
            },
          },
        });

        // The row is really there, so a null below is the guard and not an empty table.
        await expect(
          prisma.paste.findUnique({ where: { id: malformed } }),
        ).resolves.not.toBeNull();

        await expect(getPaste(VIEWER, malformed)).resolves.toBeNull();
        await expect(getPasteMeta(VIEWER, malformed)).resolves.toBeNull();
      });
    });
  },
);
