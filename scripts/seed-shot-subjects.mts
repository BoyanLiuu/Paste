/**
 * Seeds the three pastes the landing page's screenshots are taken from.
 *
 * WHY THIS EXISTS. `capture-shots.mts` photographs the real application, and PRODUCT.md
 * approves those screenshots on one condition: "they are approved evidence **because they
 * are reproducible**." The first version met that for one of four images. `read.png` came
 * from `AerfZDG4`, a row that happened to exist in one development database — so `pnpm
 * shots` died with a 404 anywhere else, and the hero of a public marketing page carried a
 * real personal handle in its breadcrumb. The expired subject was seeded but merely lapsed,
 * so the section claiming "the hash outlives the bytes" sat beside a screenshot reading
 * "The bytes are still here until 15 Dec 2026".
 *
 * WHAT IT DOES NOT DO is fake anything. Each row is the row the product itself produces:
 * real bodies, real byte and line counts, a SHA-256 actually computed over the bytes, the
 * real highlighter's output in `paste_renders`, and for the purged one the exact shape §6.4
 * phase B leaves behind — `purged_at` set, both body pointers NULL, the hash retained. Every
 * number the screenshots print is derived from the content above it.
 *
 * ADDITIVE AND IDEMPOTENT. Fixed ids, `ON CONFLICT DO NOTHING`, no TRUNCATE and no DELETE.
 * Running it twice changes nothing.
 *
 *   pnpm shots:seed
 */

import "dotenv/config";

import { createHash } from "node:crypto";

import { Client } from "pg";

import { highlight, THEME_NAME } from "@/lib/render/highlight";

import {
  LIVE_SUBJECT_ID,
  PURGED_SUBJECT_ID,
  SUBJECT_OWNER,
} from "@/lib/shot-subjects";

const DAY = 24 * 60 * 60_000;

/**
 * The hero's body. Written to photograph well AND to be a thing someone would really paste:
 * a retry helper, where `#L4-L8` lands on the loop and the backoff calculation — the part a
 * reader would actually be pointing a colleague at.
 */
const LIVE_BODY = `// Exponential backoff with full jitter.
// See the AWS Architecture Blog, "Exponential Backoff and Jitter".
async function withRetries(fn, { attempts = 5, base = 100, cap = 2_000 } = {}) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;

      const ceiling = Math.min(cap, base * 2 ** attempt);
      await sleep(Math.random() * ceiling);
    }
  }

  throw lastError;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
`;

const CONFIG_BODY = `[core]
  editor = nvim
  autocrlf = input

[alias]
  lg = log --oneline --graph --decorate -20
  fixup = commit --amend --no-edit
`;

interface Subject {
  readonly id: string;
  readonly title: string | null;
  readonly language: string;
  readonly lineNumbers: boolean;
  readonly body: string;
  readonly state: "live" | "purged";
}

const SUBJECTS: readonly Subject[] = [
  {
    id: LIVE_SUBJECT_ID,
    title: "withRetries.js",
    language: "javascript",
    lineNumbers: true,
    body: LIVE_BODY,
    state: "live",
  },
  {
    id: PURGED_SUBJECT_ID,
    title: ".gitconfig",
    language: "ini",
    lineNumbers: false,
    body: CONFIG_BODY,
    state: "purged",
  },
];

function lineCount(text: string): number {
  return text.replace(/\n$/, "").split("\n").length;
}

/**
 * The clock each state needs.
 *
 * RELATIVE TO NOW, not fixed dates. A subject seeded months ago still reads as recently
 * lapsed rather than as a date nobody recognises — and `livenessOf` recomputes expiry from
 * the clock rather than trusting `state`, so a fixed date would eventually disagree with the
 * state column and the screenshot would show a different page than the one named.
 */
function clockFor(state: Subject["state"]) {
  if (state === "live") {
    const created = new Date(Date.now() - 2 * DAY);
    return {
      created,
      retention: "30d",
      expiresAt: new Date(Date.now() + 28 * DAY),
      purgeAfter: new Date(Date.now() + 58 * DAY),
      purgedAt: null as Date | null,
    };
  }

  // Purged: well past the grace window, so phase B has destroyed the bytes.
  const expiresAt = new Date(Date.now() - 45 * DAY);
  const purgeAfter = new Date(expiresAt.getTime() + 30 * DAY);
  return {
    created: new Date(expiresAt.getTime() - DAY),
    retention: "1d",
    expiresAt,
    purgeAfter,
    purgedAt: purgeAfter as Date | null,
  };
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const user = await client.query<{ id: string }>(
      `INSERT INTO paste.users (id, username, display_name)
         VALUES (gen_random_uuid(), $1, 'Screenshot subject')
       ON CONFLICT (username) DO UPDATE SET username = paste.users.username
       RETURNING id`,
      [SUBJECT_OWNER],
    );
    const ownerId = user.rows[0].id;

    for (const subject of SUBJECTS) {
      const bytes = new TextEncoder().encode(subject.body);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const clock = clockFor(subject.state);
      const purged = clock.purgedAt !== null;

      await client.query(
        `INSERT INTO paste.pastes
           (id, owner_id, title, language, language_source, line_numbers,
            retention_code, never_reason, expires_at, purge_after, state,
            created_via, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'explicit', $5,
                 $6, NULL, $7, $8, $9,
                 'web', $10, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          subject.id,
          ownerId,
          subject.title,
          subject.language,
          subject.lineNumbers,
          clock.retention,
          clock.expiresAt,
          clock.purgeAfter,
          subject.state,
          clock.created,
        ],
      );

      // BOTH BODY POINTERS NULL WHEN PURGED, which `paste_revisions_one_body_pointer`
      // enforces as a CASE on `purged_at` — a revision cannot be born purged with its bytes
      // still attached. The hash, the size and the line count stay, because surviving the
      // purge is exactly what the 410 receipt proves.
      await client.query(
        `INSERT INTO paste.paste_revisions
           (id, paste_id, revision_no, byte_size, line_count, sha256, body_text,
            reason, scan_state, created_by, created_at, purged_at)
         VALUES (gen_random_uuid(), $1, 1, $2, $3, $4, $5,
                 'original', 'complete', $6, $7, $8)
         ON CONFLICT (paste_id, revision_no) DO NOTHING`,
        [
          subject.id,
          bytes.length,
          lineCount(subject.body),
          sha256,
          purged ? null : subject.body,
          ownerId,
          clock.created,
          clock.purgedAt,
        ],
      );

      const head = await client.query<{ id: string }>(
        `UPDATE paste.pastes
            SET head_revision_id = (SELECT id FROM paste.paste_revisions
                                     WHERE paste_id = $1 AND revision_no = 1)
          WHERE id = $1
        RETURNING head_revision_id AS id`,
        [subject.id],
      );

      // THE REAL HIGHLIGHTER, not hand-written span soup. The view page reads
      // `paste_renders` and falls back to an escaped `<pre>` when the row is missing — so
      // without this the hero screenshot would show unhighlighted text and quietly
      // contradict the claim its section makes. Skipped when purged: no bytes to render.
      const revisionId = head.rows[0]?.id;
      if (!purged && revisionId != null) {
        const html = await highlight(subject.body, subject.language);
        if (html !== null) {
          await client.query(
            `INSERT INTO paste.paste_renders (revision_id, theme, html)
                  VALUES ($1, $2, $3)
             ON CONFLICT (revision_id, theme) DO NOTHING`,
            [revisionId, THEME_NAME, html],
          );
        }
      }

      // READ BACK WHAT IS ACTUALLY STORED, because every insert above is
      // `ON CONFLICT DO NOTHING` and therefore a no-op on a row that already exists. Edit
      // `LIVE_BODY` and re-run, and the console would report the NEW byte count and hash
      // computed from the constant while the database kept the old body — so the next
      // `pnpm shots` would photograph content nobody could find in the source. A silent
      // divergence between a script's output and its effect is the same failure as a
      // hand-written number going stale, which this whole file exists to stop.
      const stored = await client.query<{ sha256: string; byte_size: number }>(
        `SELECT sha256, byte_size FROM paste.paste_revisions
          WHERE paste_id = $1 AND revision_no = 1`,
        [subject.id],
      );
      const row = stored.rows[0];
      const drifted = row !== undefined && row.sha256 !== sha256;

      console.log(
        `/p/${subject.id}  ${subject.state.padEnd(7)} ` +
          `${String(bytes.length).padStart(5)} B  ` +
          `${String(lineCount(subject.body)).padStart(3)} lines  ` +
          `sha256 ${sha256.slice(0, 8)}…${purged ? "  (bytes destroyed)" : ""}`,
      );

      if (drifted) {
        console.error(
          `\n  ${subject.id} ALREADY EXISTS WITH DIFFERENT CONTENT.\n` +
            `  stored  sha256 ${row.sha256.slice(0, 8)}… (${row.byte_size} B)\n` +
            `  wanted  sha256 ${sha256.slice(0, 8)}… (${bytes.length} B)\n` +
            `  Nothing was changed: these inserts are ON CONFLICT DO NOTHING. Delete the\n` +
            `  paste row and re-run if the new body is the one you want.\n`,
        );
        process.exitCode = 1;
      }
    }
  } finally {
    await client.end();
  }
}

await main();
