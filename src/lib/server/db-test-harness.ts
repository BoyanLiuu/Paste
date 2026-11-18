// Harness for the two tests that need a real Postgres, not a mock.
//
// The trigger and RLS are database behaviour. A mock asserting "we call the database and
// it refuses" would pass while the trigger was missing, which is the one failure the
// tests exist to catch — so these run against the real schema or they do not run.
//
// Every statement runs inside a transaction that is always rolled back. Dev and
// production share the `paste` schema (ARCHITECTURE Appendix B), so a test that commits
// is a test that writes to live data. Rollback is what makes running these against the
// real database acceptable rather than reckless.

import { randomUUID } from "node:crypto";

import { Client } from "pg";

/**
 * Why a test may be skipped, or `null` when it can run.
 *
 * Returned as a string rather than a boolean so the skip prints its reason. A silently
 * skipped database test is worse than no test: the suite stays green while the invariant
 * it guards goes unchecked.
 */
export function skipReason(): string | null {
  const url = process.env.DIRECT_URL;
  if (url === undefined || url === "") {
    return "DIRECT_URL is not set — copy .env.example to .env to run the database tests";
  }
  return null;
}

export interface Harness {
  /** Runs a statement inside the rolled-back transaction. */
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  /** Asserts a statement raises, and returns the message. Leaves the transaction usable. */
  expectRaise: (sql: string, values?: unknown[]) => Promise<string>;
  /** A committed-looking user and paste and revision, visible only inside this transaction. */
  seed: () => Promise<{ userId: string; pasteId: string; revisionId: string }>;
}

/**
 * What `seed()` writes into the revision, exported so a test can assert against it.
 *
 * Exported because the alternative bit once: a test wrote `SET line_count = 1` against a
 * row already holding 1, `IS DISTINCT FROM` saw no change, the trigger correctly stayed
 * quiet, and the test read that as a missing trigger. A test that asserts a rejection
 * has to change the value it is trying to change.
 */
export const SEEDED = {
  bodyText: "hello\nthere",
  byteSize: 11,
  lineCount: 2,
  revisionNo: 1,
  sha256: "a".repeat(64),
} as const;

/**
 * Opens a connection, begins a transaction, runs `body`, and always rolls back.
 *
 * `search_path` is set so a test can write unqualified SQL the way the demo in M6 does,
 * which is the form someone pastes into psql.
 */
export async function withRollback<T>(
  body: (h: Harness) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO paste, public");

    const query: Harness["query"] = async (sql, values) => {
      const result = await client.query(sql, values as never);
      return { rows: result.rows as Record<string, unknown>[] };
    };

    const expectRaise: Harness["expectRaise"] = async (sql, values) => {
      // A raised exception aborts the transaction and every later statement fails with
      // "current transaction is aborted". The savepoint is what lets the test keep going
      // and assert the other half — without it, only one expectation per transaction.
      const name = `sp_${randomUUID().replaceAll("-", "")}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        await client.query(sql, values as never);
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        return error instanceof Error ? error.message : String(error);
      }
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw new Error(
        `Expected this statement to raise, but it succeeded:\n${sql}`,
      );
    };

    const seed: Harness["seed"] = async () => {
      const suffix = randomUUID().slice(0, 8);
      const user = await query(
        `INSERT INTO users (id, username, display_name)
         VALUES (gen_random_uuid(), $1, 'Harness')
         RETURNING id`,
        [`harness-${suffix}`],
      );
      const userId = String(user.rows[0].id);

      // An 8-character id, the real shape from §1.3, so nothing here depends on a form
      // the application would never produce.
      const pasteId = suffix;
      await query(
        `INSERT INTO pastes
           (id, owner_id, language, language_source, retention_code, expires_at,
            purge_after, state, created_via, created_at, updated_at)
         VALUES ($1, $2, 'plaintext', 'detected', '1d', now() + interval '1 day',
                 now() + interval '31 days', 'live', 'web', now(), now())`,
        [pasteId, userId],
      );

      const revision = await query(
        `INSERT INTO paste_revisions
           (id, paste_id, revision_no, byte_size, line_count, sha256, body_text,
            reason, scan_state, created_by)
         VALUES (gen_random_uuid(), $1, $3, $4, $5, $6, $7, 'original', 'complete', $2)
         RETURNING id`,
        [
          pasteId,
          userId,
          SEEDED.revisionNo,
          SEEDED.byteSize,
          SEEDED.lineCount,
          SEEDED.sha256,
          SEEDED.bodyText,
        ],
      );

      return { userId, pasteId, revisionId: String(revision.rows[0].id) };
    };

    return await body({ query, expectRaise, seed });
  } finally {
    // Unconditional. A thrown assertion must not leave rows behind in a shared database.
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}
