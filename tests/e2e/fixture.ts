// The e2e seed harness, shared by every suite in this directory.
//
// EXTRACTED AT M12, when the hostile-content and accessibility suites needed the same four
// INSERTs. Copying them would have made four copies of the teardown — and teardown is the
// part that has already gone wrong twice in this project: once matching
// `username LIKE 'e2e-%'` globally, so Playwright's two projects deleted each other's
// fixtures mid-run, and once missing the sweeper's null-actor audit rows. A bug fixed in one
// copy of a teardown is a bug still live in the other three.
//
// FIXTURES GO THROUGH THE DATABASE, not through the API. The first version created them
// with `POST /api/pastes`, which stopped working the moment M10 wired Clerk: signed out,
// that endpoint answers 401, correctly. There is no way to create a paste without a browser
// session, which is a property of the product rather than a gap in the harness.
//
// RAW `pg`, NOT THE PRISMA CLIENT. Importing the generated client here failed with
// "Cannot use 'import.meta' outside a module": Playwright's TypeScript loader does not treat
// the generated ESM as a module, and the suite reported "No tests found" — a run that
// executed nothing and exited 1. These fixtures are four INSERTs; they do not need an ORM.

import { Client } from "pg";

import { newPasteId } from "../../src/lib/ids";

export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{8}$/;

export async function withDb<T>(body: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

export interface Seeded {
  id: string;
  body: string;
  owner: string;
}

/**
 * Usernames THIS worker created, so teardown removes only those.
 *
 * Teardown matched `username LIKE 'e2e-%'` at first, which is a global pattern — and
 * Playwright runs the desktop and phone projects concurrently, so each project's `afterAll`
 * deleted the other's fixtures mid-run. Three tests failed for a reason that had nothing to
 * do with the app, the same way the sweeper's specs raced each other through a global job.
 */
const mine: string[] = [];

/** A paste owned by a throwaway user, inserted directly. */
export async function seed(options: {
  body?: string;
  title?: string | null;
  language?: string;
  expiresInMinutes?: number | null;
  state?: string;
}): Promise<Seeded> {
  const body = options.body ?? "hello from the fixture\n";
  const id = newPasteId();
  const owner = `e2e-${id.toLowerCase()}`;

  const expiresAt =
    options.expiresInMinutes === null
      ? null
      : new Date(Date.now() + (options.expiresInMinutes ?? 1440) * 60_000);

  return withDb(async (c) => {
    const user = await c.query<{ id: string }>(
      `INSERT INTO paste.users (id, username, display_name)
       VALUES (gen_random_uuid(), $1, 'E2E') RETURNING id`,
      [owner],
    );
    const ownerId = user.rows[0].id;

    await c.query(
      `INSERT INTO paste.pastes
         (id, owner_id, title, language, language_source, retention_code, never_reason,
          expires_at, purge_after, state, created_via, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'explicit', $5, $6, $7, $8, $9, 'web', now(), now())`,
      [
        id,
        ownerId,
        options.title ?? null,
        options.language ?? "python",
        expiresAt === null ? "never" : "1d",
        expiresAt === null ? "an e2e fixture" : null,
        expiresAt,
        expiresAt === null
          ? null
          : new Date(expiresAt.getTime() + 30 * 24 * 60 * 60_000),
        options.state ?? "live",
      ],
    );

    await c.query(
      `INSERT INTO paste.paste_revisions
         (id, paste_id, revision_no, byte_size, line_count, sha256, body_text,
          reason, scan_state, created_by)
       VALUES (gen_random_uuid(), $1, 1, $2, $3, repeat('a', 64), $4,
               'original', 'complete', $5)`,
      [
        id,
        new TextEncoder().encode(body).length,
        body.replace(/\n$/, "").split("\n").length,
        body,
        ownerId,
      ],
    );

    mine.push(owner);
    return { id, body, owner };
  });
}

/**
 * Remove every user the calling file created, and everything they own.
 *
 * Call it from the suite's own `test.afterAll`. Deliberately NOT registered here: a
 * module-level `afterAll` in an imported file runs inside whichever suite imported it, which
 * is a quieter version of the global-teardown mistake this extraction exists to stop
 * repeating.
 */
export async function cleanUpSeeded(): Promise<void> {
  await withDb(async (c) => {
    if (mine.length === 0) return;

    const users = await c.query<{ id: string }>(
      `SELECT id FROM paste.users WHERE username = ANY($1::text[])`,
      [mine],
    );
    for (const { id } of users.rows) {
      // Audit rows are found by subject as well as by actor: the sweeper writes
      // `paste.purged` with a null actor, so deleting by actor alone leaves them behind.
      const pastes = await c.query<{ id: string }>(
        `SELECT id FROM paste.pastes WHERE owner_id = $1`,
        [id],
      );
      for (const p of pastes.rows) {
        await c.query(`DELETE FROM paste.audit_log WHERE subject_id = $1`, [
          p.id,
        ]);
      }
      await c.query(`DELETE FROM paste.audit_log WHERE actor_id = $1`, [id]);
      await c.query(`DELETE FROM paste.pastes WHERE owner_id = $1`, [id]);
      await c.query(`DELETE FROM paste.users WHERE id = $1`, [id]);
    }
    mine.length = 0;
  });
}
