/**
 * Seeds the one paste state the landing page needs and the database cannot supply.
 *
 * WHY THIS EXISTS. `capture-shots.mts` photographs real rows, and three of its four
 * subjects are already there. The 410 receipt is not: every expired paste in the
 * development database is an 11-byte `plaintext` row from a load test, with no title and a
 * `repeat('a', 64)` hash from the e2e fixture. A receipt whose SHA-256 reads
 * `aaaaaaaa…aaaa` beside "11 B · 1 lines" is worse evidence than no screenshot, because it
 * tells a visitor the numbers on this page are decorative.
 *
 * WHAT IT DOES NOT DO. It does not fake the receipt. The row it writes is the row the
 * sweeper produces: a real body, its real length, its real line count, and a SHA-256
 * actually computed over the bytes — then `state = 'expired'` with `expires_at` in the past
 * and `purge_after` 30 days later, which is precisely the shape §6.4's phase A leaves
 * behind. Every number the tombstone prints is derived from the content above it, so the
 * screenshot is a photograph of the product working rather than an illustration of it.
 *
 * ADDITIVE AND IDEMPOTENT. Fixed ids, `ON CONFLICT DO NOTHING`, no TRUNCATE and no DELETE.
 * Running it twice changes nothing; running it on a database that already has the subject
 * is a no-op.
 *
 *   pnpm shots:seed
 */

import "dotenv/config";

import { createHash } from "node:crypto";

import { Client } from "pg";

import { EXPIRED_SUBJECT_ID } from "./shot-subjects.mjs";

const OWNER = "shots-demo";

/** A real stack trace. Machine output is what PRODUCT.md says people actually paste. */
const BODY = `Traceback (most recent call last):
  File "/srv/payments/worker.py", line 184, in _settle
    receipt = gateway.capture(intent.id, amount_cents=intent.amount)
  File "/srv/payments/gateway.py", line 97, in capture
    return self._post("/v2/captures", body, idempotency_key=key)
  File "/srv/payments/gateway.py", line 142, in _post
    raise GatewayTimeout(f"{path} did not answer in {self.timeout}s")
payments.gateway.GatewayTimeout: /v2/captures did not answer in 8s

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/srv/payments/worker.py", line 203, in run
    self._settle(intent)
  File "/srv/payments/worker.py", line 191, in _settle
    raise SettlementFailed(intent.id) from exc
payments.errors.SettlementFailed: pi_3QkL8x2eZvKY
`;

function lineCount(text: string): number {
  return text.replace(/\n$/, "").split("\n").length;
}

async function main() {
  const bytes = new TextEncoder().encode(BODY);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // Lapsed four days ago, so the receipt reads as a link someone followed late rather
  // than one that expired while the page was loading.
  const expiresAt = new Date(Date.now() - 4 * 24 * 60 * 60_000);
  const purgeAfter = new Date(expiresAt.getTime() + 30 * 24 * 60 * 60_000);
  const createdAt = new Date(expiresAt.getTime() - 60 * 60_000);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const user = await client.query<{ id: string }>(
      `INSERT INTO paste.users (id, username, display_name)
         VALUES (gen_random_uuid(), $1, 'Screenshot subject')
       ON CONFLICT (username) DO UPDATE SET username = paste.users.username
       RETURNING id`,
      [OWNER],
    );
    const ownerId = user.rows[0].id;

    await client.query(
      `INSERT INTO paste.pastes
         (id, owner_id, title, language, language_source, line_numbers,
          retention_code, never_reason, expires_at, purge_after, state,
          created_via, created_at, updated_at)
       VALUES ($1, $2, $3, 'python', 'sniff', true,
               '1d', NULL, $4, $5, 'expired',
               'web', $6, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        EXPIRED_SUBJECT_ID,
        ownerId,
        "settlement worker traceback",
        expiresAt,
        purgeAfter,
        createdAt,
      ],
    );

    await client.query(
      `INSERT INTO paste.paste_revisions
         (id, paste_id, revision_no, byte_size, line_count, sha256, body_text,
          reason, scan_state, created_by, created_at)
       VALUES (gen_random_uuid(), $1, 1, $2, $3, $4, $5,
               'original', 'complete', $6, $7)
       ON CONFLICT (paste_id, revision_no) DO NOTHING`,
      [
        EXPIRED_SUBJECT_ID,
        bytes.length,
        lineCount(BODY),
        sha256,
        BODY,
        ownerId,
        createdAt,
      ],
    );

    await client.query(
      `UPDATE paste.pastes
          SET head_revision_id = (SELECT id FROM paste.paste_revisions
                                   WHERE paste_id = $1 AND revision_no = 1)
        WHERE id = $1 AND head_revision_id IS NULL`,
      [EXPIRED_SUBJECT_ID],
    );

    console.log(
      `/p/${EXPIRED_SUBJECT_ID} — expired, ${bytes.length} B, ${lineCount(BODY)} lines, sha256 ${sha256.slice(0, 8)}…`,
    );
  } finally {
    await client.end();
  }
}

await main();
