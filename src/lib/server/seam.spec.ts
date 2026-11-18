// @vitest-environment node

// The seam ARCHITECTURE Appendix C promises (M7 test requirement 5).
//
// Phase 1 built every screen against fixtures shaped like `Paste`. Phase 2 has to produce
// that exact shape from the database, or the swap is a rewrite of every component rather
// than a change of one module's body. The failure this catches is signature and shape
// drift: a mapper that returns `expiresAt` as a `Date`, or omits `bodyShown`, or hands
// back `undefined` where the type says `null`.
//
// Every one of those type-checks at the call site and then renders wrongly — a `Date`
// stringifies to a different format than the fixtures' ISO strings, and `undefined`
// serialises differently across the RSC boundary from `null`, so a component testing
// `=== null` silently stops matching.

import { describe, expect, it } from "vitest";

import { PASTES_BY_ID } from "@/lib/fixtures";
import { skipReason, withTestOwner } from "@/lib/server/create-test-harness";
import { createPaste } from "@/lib/server/mutations";
import type { Paste } from "@/lib/types";

const reason = skipReason();

/** A fixture to compare against: the shape the screens were built for. */
const REFERENCE = PASTES_BY_ID["7fK2mQxZ"];

describe.skipIf(reason !== null)(
  `the fixture/database seam${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("returns exactly the fixture's keys, no more and no fewer", async () => {
      await withTestOwner(async (owner) => {
        const fromDb = await createPaste(owner.viewer, {
          body: "def f():\n    return 1\n",
          language: "python",
          retention: "1h",
        });

        // Key-for-key. An extra key is a leak of row shape into the domain type; a
        // missing one is a component reading `undefined` and rendering nothing.
        expect(Object.keys(fromDb).sort()).toEqual(
          Object.keys(REFERENCE).sort(),
        );
      });
    });

    it("matches the fixture's type for every field, including null vs undefined", async () => {
      await withTestOwner(async (owner) => {
        const fromDb = await createPaste(owner.viewer, {
          body: "def f():\n    return 1\n",
          language: "python",
          retention: "1h",
        });

        for (const key of Object.keys(REFERENCE) as (keyof Paste)[]) {
          const a = REFERENCE[key];
          const b = fromDb[key];

          // `null` is its own case on purpose. The domain type says `| null` rather than
          // optional precisely because the two serialise differently across the RSC
          // boundary, and a component testing `=== null` would never match `undefined`.
          if (a === null || b === null) {
            expect(
              b === null || a === null,
              `${key}: fixture ${JSON.stringify(a)} vs db ${JSON.stringify(b)}`,
            ).toBe(true);
            continue;
          }

          expect(
            Array.isArray(b),
            `${key} should ${Array.isArray(a) ? "" : "not "}be an array`,
          ).toBe(Array.isArray(a));
          expect(typeof b, `${key} type`).toBe(typeof a);
        }
      });
    });

    it("formats dates as the ISO strings the fixtures use", async () => {
      await withTestOwner(async (owner) => {
        const fromDb = await createPaste(owner.viewer, {
          body: "text\n",
          retention: "1h",
        });

        // A `Date` here type-checks nowhere and renders everywhere — as
        // "Wed Nov 18 2026 …" instead of the fixtures' ISO form, through a formatter
        // that happens to accept both.
        expect(typeof fromDb.createdAt).toBe("string");
        expect(fromDb.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
        expect(typeof fromDb.expiresAt).toBe("string");
        expect(fromDb.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
        expect(fromDb.purgeAfter).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

        for (const revision of fromDb.revisions) {
          expect(revision.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
        }
      });
    });

    it("shapes revisions like the fixtures' revisions", async () => {
      await withTestOwner(async (owner) => {
        const fromDb = await createPaste(owner.viewer, {
          body: "text\n",
          retention: "1h",
        });

        expect(fromDb.revisions).toHaveLength(1);
        expect(Object.keys(fromDb.revisions[0]).sort()).toEqual(
          Object.keys(REFERENCE.revisions[0]).sort(),
        );
        expect(fromDb.revisions[0].no).toBe(1);
        expect(fromDb.revisions[0].reason).toBe("original");
        // The username, not the uuid. A raw foreign key reaching a component is the
        // commonest form of this drift, and it renders as a uuid next to "created by".
        expect(fromDb.revisions[0].createdBy).toBe(owner.username);
      });
    });

    it("agrees with the body it was given", async () => {
      await withTestOwner(async (owner) => {
        const body = "line one\nline two\nline three\n";
        const fromDb = await createPaste(owner.viewer, {
          body,
          retention: "1h",
        });

        expect(fromDb.body).toBe(body);
        // Three lines, not four. A trailing newline is a terminator, and when the
        // counter and the renderer disagreed a 40-line paste stored 41 — so `#L41`
        // existed in the DOM while the range parser refused it.
        expect(fromDb.lineCount).toBe(3);
        expect(fromDb.bodyShown).toBe(3);
        expect(fromDb.byteSize).toBe(new TextEncoder().encode(body).length);
        expect(fromDb.storage).toBe("postgres");
      });
    });

    it("normalises CRLF and the BOM before storing", async () => {
      await withTestOwner(async (owner) => {
        const fromDb = await createPaste(owner.viewer, {
          body: "﻿first\r\nsecond\r\n",
          retention: "1h",
        });

        // Stored canonical, not as submitted. A CR left in place renders as a control
        // character inside the line content, and a leading BOM becomes an invisible first
        // character that stops `#!/bin/sh` matching the ladder's first-line sniff.
        expect(fromDb.body).toBe("first\nsecond\n");
        expect(fromDb.body).not.toContain("\r");
        expect(fromDb.body!.startsWith("﻿")).toBe(false);
        expect(fromDb.lineCount).toBe(2);
      });
    });
  },
);
