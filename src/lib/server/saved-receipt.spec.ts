// @vitest-environment node

// The forged "Saved." receipt (ARCHITECTURE §6.3).
//
// The create page shows its confirmation from `?saved=<id>` on the URL, which is what lets
// the page's heading disappear with the form and every "New paste" link navigate away from
// it. The cost of putting it there is that the id is now attacker-supplied like any query
// parameter — and the first version checked only its SHAPE.
//
// So `?saved=zzzzzzzz` rendered a complete receipt for a paste that never existed, with a
// "View paste" button answering 404, and `?saved=<anyone else's id>` rendered one asserting
// the viewer had saved somebody else's paste. Screenshot either and you have a receipt for
// something that did not happen. §6.3 refuses exactly this for tombstones — an unknown id
// answers 404 rather than 410 so that nobody can mint one — and the create screen had the
// same hole pointing the other way.
//
// This file exists because the panel itself cannot be tested: it needs a session to own a
// paste, and a component test cannot load `@testing-library/react` under the `react-server`
// resolve condition. The DECISION is testable, so the decision is what moved into a module.

import { describe, expect, it } from "vitest";

import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { mayShowSavedReceipt } from "@/lib/server/saved-receipt";
import type { Viewer } from "@/lib/types";

const ANON: Viewer = { kind: "anon" };
const reason = skipReason();

describe.skipIf(reason !== null)(
  `the saved receipt's gate${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("shows the receipt to the person who saved the paste", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{ body: "x = 1\n" }]);
        // Guards the guard: a gate that refused everything would pass every assertion
        // below and silently delete the confirmation screen.
        expect(await mayShowSavedReceipt(owner.viewer, id)).toBe(true);
      });
    });

    it("refuses an id for a paste that never existed", async () => {
      await withTestOwner(async (owner) => {
        // Well-formed base58, so this cannot pass by being rejected on shape — which is
        // the whole point, since shape was all the first version checked.
        expect(await mayShowSavedReceipt(owner.viewer, "zzzzzzzz")).toBe(false);
      });
    });

    it("refuses somebody else's paste", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{ body: "x = 1\n" }]);

        await withTestOwner(async (stranger) => {
          // The paste is real, public and readable — `/p/<id>` serves it to anyone. What
          // must not happen is a screen telling this person they saved it.
          expect(await mayShowSavedReceipt(stranger.viewer, id)).toBe(false);
        });
      });
    });

    it("refuses a signed-out visitor outright", async () => {
      await withTestOwner(async (owner) => {
        const [id] = await seedPastes(owner.userId, [{ body: "x = 1\n" }]);
        // Saving requires a session, so there is no honest way for an anon viewer to hold
        // this parameter. Checked before the query, because it is also the common case.
        expect(await mayShowSavedReceipt(ANON, id)).toBe(false);
      });
    });
  },
);
