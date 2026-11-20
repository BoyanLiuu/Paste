// @vitest-environment node

// RLS is defence in depth, not the authorization model (ARCHITECTURE §6.5).
//
// Ownership is enforced in the service layer with an explicit WHERE. This test exists for
// when that is wrong: it asserts that a leaked anon key reads nothing even then. The
// mistake it is written against is the opposite one — reading a passing RLS test as
// permission to drop the service-layer check.
//
// It asserts both directions, for the same reason the immutability test does. RLS that
// also blocks the application is not secure, it is broken: every page would render empty
// and the cause would look like a data problem rather than a policy one.

import { describe, expect, it } from "vitest";

import { skipReason, withRollback } from "@/lib/server/db-test-harness";

/** Every table the migration creates. Listed rather than discovered, so a table added
 *  without RLS fails here instead of quietly passing a query that found nothing. */
const TABLES = [
  "users",
  "pastes",
  "paste_revisions",
  "paste_renders",
  "secret_findings",
  "deletion_requests",
  "audit_log",
  "rate_buckets",
  // M14. Added here deliberately, which is what this list is for: the table arrived
  // without `ENABLE ROW LEVEL SECURITY` and this test is what said so.
  "ip_buckets",
  "paste_views",
] as const;

const reason = skipReason();

describe.skipIf(reason !== null)(
  `row level security${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("is enabled on every table, and every table has zero policies", async () => {
      await withRollback(async (h) => {
        const result = await h.query(
          `SELECT c.relname AS table_name,
                c.relrowsecurity AS enabled,
                (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'paste' AND c.relkind = 'r'
            AND c.relname <> '_prisma_migrations'
          ORDER BY c.relname`,
        );

        // Both sides sorted in JS. Postgres orders by the database collation, which under
        // a locale that de-prioritises underscores ranks `pastes` before `paste_views`;
        // the two orderings agree here by luck, not by rule.
        const names = result.rows.map((r) => String(r.table_name)).sort();
        expect(names).toEqual([...TABLES].sort());

        for (const row of result.rows) {
          expect(row.enabled, `RLS on paste.${row.table_name}`).toBe(true);
          // Zero policies is the design, not an oversight. A policy here would be a second
          // authorization model competing with the service layer's WHERE, and the two would
          // disagree the first time either changed.
          expect(
            Number(row.policies),
            `policies on paste.${row.table_name}`,
          ).toBe(0);
        }
      });
    });

    it("grants the anon and authenticated roles nothing at all", async () => {
      await withRollback(async (h) => {
        // The wall in front of RLS, and the stronger one. RLS filters rows for a role that
        // may read the table; no grant means the role may not read it at all. The
        // architecture named PostgREST exposure and RLS — this is the third.
        const result = await h.query(
          `SELECT grantee, table_name, privilege_type
           FROM information_schema.role_table_grants
          WHERE table_schema = 'paste'
            AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
        );
        expect(result.rows).toEqual([]);
      });
    });

    it("denies anon the schema itself, which it holds on public", async () => {
      await withRollback(async (h) => {
        // The outermost wall, and the one that makes schema-per-app a security boundary
        // rather than tidiness. The contrast with `public` is the point: Supabase grants
        // anon USAGE there by default, so a table in `public` starts one wall down.
        const result = await h.query(
          `SELECT has_schema_privilege('anon', 'paste', 'USAGE')  AS on_paste,
                has_schema_privilege('anon', 'public', 'USAGE') AS on_public`,
        );
        expect(result.rows[0].on_paste).toBe(false);
        expect(result.rows[0].on_public).toBe(true);
      });
    });

    it("refuses the anon role, and serves the app role, on the same row", async () => {
      await withRollback(async (h) => {
        const { pasteId } = await h.seed();

        // The app role first, so the fixture is known to be readable before the anon
        // assertion means anything. Without this, "anon reads nothing" would also pass
        // against an empty table.
        const asApp = await h.query(
          `SELECT id FROM paste.pastes WHERE id = $1`,
          [pasteId],
        );
        expect(asApp.rows).toHaveLength(1);

        // `SET LOCAL ROLE` is reverted by the surrounding ROLLBACK along with everything
        // else, so the connection cannot leak a downgraded role to another test.
        await h.query(`SET LOCAL ROLE anon`);

        // Schema-qualified deliberately. Unqualified, this fails with `relation "pastes"
        // does not exist`, which is the same message a missing table gives — the test
        // would then pass against a dropped table and prove nothing about privileges.
        const message = await h.expectRaise(
          `SELECT id FROM paste.pastes WHERE id = $1`,
          [pasteId],
        );
        expect(message).toMatch(/permission denied for schema paste/i);

        await h.query(`RESET ROLE`);
        const backAsApp = await h.query(
          `SELECT id FROM paste.pastes WHERE id = $1`,
          [pasteId],
        );
        expect(backAsApp.rows).toHaveLength(1);
      });
    });

    it("would still return zero rows to anon if someone granted it access", async () => {
      await withRollback(async (h) => {
        const { pasteId } = await h.seed();

        // The scenario the tests above cannot reach: a future migration, or a click in the
        // Supabase dashboard, hands anon the schema and the table. RLS is the wall that has
        // to hold then, and this is the only test that exercises it rather than the grants
        // in front of it. Both grants are needed to get that far, which is itself the
        // measure of how many things have to go wrong first.
        await h.query(`GRANT USAGE ON SCHEMA paste TO anon`);
        await h.query(`GRANT SELECT ON paste.pastes TO anon`);
        await h.query(`SET LOCAL ROLE anon`);

        const result = await h.query(
          `SELECT id FROM paste.pastes WHERE id = $1`,
          [pasteId],
        );
        // No error now — the grants are there. Zero rows, because there is no policy to
        // permit any. This is the half that makes RLS worth enabling.
        expect(result.rows).toEqual([]);

        await h.query(`RESET ROLE`);
      });
    });

    it("lets the app role bypass RLS rather than depend on a policy", async () => {
      await withRollback(async (h) => {
        // Why the app is unaffected by all of the above. If this role ever lost BYPASSRLS,
        // every query would return zero rows against a schema with no policies, and the
        // app would look empty rather than broken.
        const result = await h.query(
          `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`,
        );
        expect(result.rows[0].rolbypassrls).toBe(true);
      });
    });
  },
);
