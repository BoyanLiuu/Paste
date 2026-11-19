// @vitest-environment node

// Cross-tenant leakage (ARCHITECTURE §3).
//
// `/list/:username` takes the username from the URL, not from the session, because the
// page is public — anyone may read anyone's list. That is the premise, and it is also what
// makes the scoping bug invisible to whoever builds it: a missing `owner` clause returns
// the whole table, and with one account in the database the page looks exactly right.
//
// The bug only appears with two accounts, which is why this test has two.

import { describe, expect, it } from "vitest";

import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { getPaste, listPastes, pasteSummary } from "@/lib/server/paste-service";
import type { Viewer } from "@/lib/types";

const VISITOR: Viewer = { kind: "anon" };
const reason = skipReason();

describe.skipIf(reason !== null)(
  `ownership${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("shows each person only their own pastes", async () => {
      await withTestOwner(async (alice) => {
        await withTestOwner(async (bob) => {
          const aliceIds = await seedPastes(alice.userId, [{}, {}, {}]);
          const bobIds = await seedPastes(bob.userId, [{}, {}]);

          const aliceList = await listPastes(VISITOR, alice.username);
          const bobList = await listPastes(VISITOR, bob.username);

          expect(aliceList.total).toBe(3);
          expect(bobList.total).toBe(2);

          // Set comparison, not just counts. Equal counts would pass while the rows were
          // swapped, and "the right number of someone else's pastes" is still a leak.
          expect(aliceList.items.map((p) => p.id).toSorted()).toEqual(
            aliceIds.toSorted(),
          );
          expect(bobList.items.map((p) => p.id).toSorted()).toEqual(
            bobIds.toSorted(),
          );

          // And neither list contains any of the other's.
          for (const id of bobIds) {
            expect(aliceList.items.some((p) => p.id === id)).toBe(false);
          }
        });
      });
    });

    it("scopes the summary counts too, not just the page", async () => {
      await withTestOwner(async (alice) => {
        await withTestOwner(async (bob) => {
          await seedPastes(alice.userId, [{}, {}, { expiresInMinutes: -60 }]);
          await seedPastes(bob.userId, [{}]);

          const summary = await pasteSummary(VISITOR, alice.username);
          // The "N pastes, M stored" line and the filter tabs are a second query, so they
          // can leak independently of the list. They did once in a different way — being
          // derived from one page rather than the collection.
          expect(summary.all).toBe(3);
          expect(summary.live).toBe(2);
          expect(summary.gone).toBe(1);
        });
      });
    });

    it("records the real owner on a paste created through the service", async () => {
      await withTestOwner(async (alice) => {
        const { createPaste } = await import("@/lib/server/mutations");
        const paste = await createPaste(alice.viewer, {
          body: "mine\n",
          retention: "1h",
        });

        // The acting user comes from the session, never from an argument (§3). `createPaste`
        // takes a viewer and resolves the row itself; there is no owner parameter to spoof.
        expect(paste.owner).toBe(alice.username);

        const fetched = await getPaste(VISITOR, paste.id);
        expect(fetched!.owner).toBe(alice.username);
      });
    });

    it("lets a visitor read someone else's paste, which is the premise", async () => {
      await withTestOwner(async (alice) => {
        const [id] = await seedPastes(alice.userId, [{ body: "public\n" }]);

        // Guards the guard: a scoping fix that required a session to read would pass every
        // leakage assertion above and break the product. Reads are public — the id is the
        // access control, not a cookie.
        const paste = await getPaste(VISITOR, id);
        expect(paste).not.toBeNull();
        expect(paste!.body).toBe("public\n");

        const list = await listPastes(VISITOR, alice.username);
        expect(list.total).toBe(1);
      });
    });

    it("gives an empty page for a username that does not exist", async () => {
      // Not an error, and not everyone's pastes. A typo'd username is a plausible URL and
      // must not be a way to enumerate the table.
      const list = await listPastes(VISITOR, "nobody-by-this-name");
      expect(list.items).toEqual([]);
      expect(list.total).toBe(0);
    });
  },
);
