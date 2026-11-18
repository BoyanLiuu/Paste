// @vitest-environment node

// The central invariant, tested where it is enforced (ARCHITECTURE §6.3).
//
// "A stored body is never rewritten" is the claim the whole design rests on: the
// permanent identifier, the tombstone that proves what used to be there, the revision
// chain. Code can promise it; only the trigger makes it true for every connection,
// including a psql session and a future feature written by someone who never read §6.3.
//
// So every test here asserts BOTH halves. A trigger that rejects everything is as broken
// as one that rejects nothing — it would block the purge, and the purge is how a
// takedown actually removes bytes.

import { describe, expect, it } from "vitest";

import { SEEDED, skipReason, withRollback } from "@/lib/server/db-test-harness";

const reason = skipReason();

describe.skipIf(reason !== null)(
  `revision immutability${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("refuses to rewrite a body", async () => {
      await withRollback(async (h) => {
        const { revisionId } = await h.seed();

        const message = await h.expectRaise(
          `UPDATE paste_revisions SET body_text = 'x' WHERE id = $1`,
          [revisionId],
        );

        // The message names the revision, because a bare "trigger raised" in a production
        // log tells whoever is paged nothing about which row was involved.
        expect(message).toContain("may only be purged, not rewritten");
        expect(message).toContain(revisionId);

        // And the row is unchanged, not merely un-updated. The assertion above would pass
        // against a trigger that raised after writing.
        const after = await h.query(
          `SELECT body_text FROM paste_revisions WHERE id = $1`,
          [revisionId],
        );
        expect(after.rows[0].body_text).toBe(SEEDED.bodyText);
      });
    });

    it("allows the purge: both pointers to NULL with purged_at set", async () => {
      await withRollback(async (h) => {
        const { revisionId } = await h.seed();

        await h.query(
          `UPDATE paste_revisions
            SET body_text = NULL, storage_key = NULL, purged_at = now()
          WHERE id = $1`,
          [revisionId],
        );

        const after = await h.query(
          `SELECT body_text, storage_key, purged_at, sha256
           FROM paste_revisions WHERE id = $1`,
          [revisionId],
        );
        expect(after.rows[0].body_text).toBeNull();
        expect(after.rows[0].storage_key).toBeNull();
        expect(after.rows[0].purged_at).not.toBeNull();
        // The hash survives the purge. It is what lets a tombstone prove what used to be
        // there, so a reader can check a local copy against it (§6.3).
        expect(after.rows[0].sha256).toBe(SEEDED.sha256);
      });
    });

    it("refuses a body change that only pretends to be a purge", async () => {
      await withRollback(async (h) => {
        const { revisionId } = await h.seed();

        // The gap a naive trigger leaves: null the body, skip `purged_at`. The row then
        // looks purged to the sweeper while no takedown was ever recorded, and the CHECK
        // alone would not catch it — this is a deletion disguised as housekeeping.
        const message = await h.expectRaise(
          `UPDATE paste_revisions SET body_text = NULL WHERE id = $1`,
          [revisionId],
        );
        expect(message).toContain("may only be purged, not rewritten");
      });
    });

    it("refuses to change identity or size, purge or not", async () => {
      await withRollback(async (h) => {
        const { revisionId } = await h.seed();

        // Each of these would let a paste claim bytes it never held. `sha256` is the worst:
        // it is the tombstone's evidence, so a rewritable hash makes the tombstone a lie.
        //
        // Every value is derived from SEEDED so it cannot accidentally equal what is
        // already stored — `IS DISTINCT FROM` would then see no change and the trigger
        // would stay quiet, which reads identically to a missing trigger.
        const changes = [
          `revision_no = ${SEEDED.revisionNo + 8}`,
          `byte_size = ${SEEDED.byteSize + 1}`,
          `line_count = ${SEEDED.lineCount + 1}`,
          `sha256 = repeat('b', 64)`,
          `paste_id = 'zzzzzzzz'`,
          // The four below were writable until the second migration. The trigger was a
          // denylist of five columns where Appendix D's prose specifies an allowlist of
          // three, so everything it forgot to name was quietly mutable.
          `id = gen_random_uuid()`,
          `created_at = now() - interval '10 years'`,
          `reason = 'edit'`,
        ];

        for (const change of changes) {
          const message = await h.expectRaise(
            `UPDATE paste_revisions SET ${change} WHERE id = $1`,
            [revisionId],
          );
          expect(message, change).toContain("is immutable");
          // The exception names the column. Without it, whoever is paged has to read the
          // trigger source to find out which of fourteen columns they touched.
          expect(message, change).toContain(change.split(" ")[0]);
        }
      });
    });

    it("still allows the supersession the revision chain needs", async () => {
      await withRollback(async (h) => {
        const { revisionId } = await h.seed();

        // Destructive supersession is the only edit the product offers (§6.3): revision 1
        // is stamped superseded and revision 2 carries the new bytes. A trigger that
        // locked the whole row would make editing impossible, so this is the half that
        // proves it is scoped to the body and the identity rather than to the row.
        await h.query(
          `UPDATE paste_revisions SET superseded_at = now() WHERE id = $1`,
          [revisionId],
        );

        const after = await h.query(
          `SELECT superseded_at FROM paste_revisions WHERE id = $1`,
          [revisionId],
        );
        expect(after.rows[0].superseded_at).not.toBeNull();
      });
    });

    it("refuses a revision with neither body pointer, and one with both", async () => {
      await withRollback(async (h) => {
        const { pasteId, userId } = await h.seed();

        const insert = (body: string, key: string) =>
          h.expectRaise(
            `INSERT INTO paste_revisions
             (id, paste_id, revision_no, byte_size, line_count, sha256,
              body_text, storage_key, reason, created_by)
           VALUES (gen_random_uuid(), $1, 2, 5, 1, repeat('c', 64),
                   ${body}, ${key}, 'edit', $2)`,
            [pasteId, userId],
          );

        // Neither: a live revision with no bytes anywhere, which renders as a tombstone
        // for a paste nobody took down.
        expect(await insert("NULL", "NULL")).toContain("one_body_pointer");
        // Both: two sources of truth for the same bytes, and no rule saying which wins.
        expect(await insert("'hello'", "'k/1'")).toContain("one_body_pointer");
      });
    });

    it("refuses a revision born purged but still holding its bytes", async () => {
      await withRollback(async (h) => {
        const { pasteId, userId } = await h.seed();

        // The hole the first migration's CHECK left: it read
        // `purged_at IS NOT NULL OR (exactly one pointer)`, which short-circuits, so a
        // purged row could keep its body. That is a tombstone rendering over content
        // nobody destroyed — the one state the whole takedown story must not permit.
        const message = await h.expectRaise(
          `INSERT INTO paste_revisions
             (id, paste_id, revision_no, byte_size, line_count, sha256,
              body_text, reason, created_by, purged_at)
           VALUES (gen_random_uuid(), $1, 2, 5, 1, repeat('c', 64),
                   'hello', 'edit', $2, now())`,
          [pasteId, userId],
        );
        expect(message).toContain("one_body_pointer");
      });
    });

    it("refuses to un-purge, which would let a tombstone claim its bytes back", async () => {
      await withRollback(async (h) => {
        const { revisionId } = await h.seed();

        await h.query(
          `UPDATE paste_revisions
              SET body_text = NULL, storage_key = NULL, purged_at = now()
            WHERE id = $1`,
          [revisionId],
        );

        // Clearing `purged_at` alone leaves a live revision with no bytes — caught by the
        // CHECK rather than the trigger, which is worth asserting because the two guard
        // overlapping ground and neither alone covers this.
        const message = await h.expectRaise(
          `UPDATE paste_revisions SET purged_at = NULL WHERE id = $1`,
          [revisionId],
        );
        expect(message).toContain("one_body_pointer");
      });
    });

    it("refuses to change the author, which the audit trail cites", async () => {
      await withRollback(async (h) => {
        const { revisionId } = await h.seed();

        // Needs a genuinely different user. Setting `created_by` to the value already
        // stored is not a change, `IS DISTINCT FROM` says so, and the trigger correctly
        // stays quiet — a false pass that cost a round of review here already.
        const impostor = await h.query(
          `INSERT INTO users (id, username) VALUES (gen_random_uuid(), $1) RETURNING id`,
          [`impostor-${Date.now()}`],
        );

        const message = await h.expectRaise(
          `UPDATE paste_revisions SET created_by = $2 WHERE id = $1`,
          [revisionId, impostor.rows[0].id],
        );
        expect(message).toContain("created_by");
      });
    });

    it("allows scan_state, the third word in the allowed vocabulary", async () => {
      await withRollback(async (h) => {
        const { revisionId } = await h.seed();

        // `superseded_at` and `purged_at` are covered above; this is the third. All three
        // must stay writable, because the allowlist trigger would otherwise block the
        // background scan from recording that it finished (§6.1).
        await h.query(
          `UPDATE paste_revisions SET scan_state = 'complete' WHERE id = $1`,
          [revisionId],
        );
        const after = await h.query(
          `SELECT scan_state FROM paste_revisions WHERE id = $1`,
          [revisionId],
        );
        expect(after.rows[0].scan_state).toBe("complete");
      });
    });
  },
);
