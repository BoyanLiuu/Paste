// Harness for the M7 tests, which exercise the create path through Prisma.
//
// WHY THIS COMMITS, where db-test-harness.ts rolls back.
//
// The rollback harness drives raw `pg`, so everything it does lives inside one
// transaction it can abort. These tests call `createPaste`, which opens its own Prisma
// transaction on a different connection — there is no outer transaction to enrol it in,
// and nesting one is not something Prisma exposes. Pointing Prisma at a second schema is
// also out: `multiSchema` bakes `"paste"."…"` into every generated query, so the schema
// name is not a runtime choice.
//
// So these tests commit, and clean up after themselves. The cleanup is what makes that
// acceptable, and it is scoped deliberately:
//
//   - Every test owns a user whose username is generated and namespaced `t-<random>`,
//     so a leaked row is identifiable at a glance rather than looking like real data.
//   - Teardown deletes BY THAT USER'S ID and nothing else. There is no statement here
//     that could match a row the test did not create. No TRUNCATE, no DELETE without a
//     WHERE on a generated id — dev and production share this schema (Appendix B).
//   - Audit rows go first. `actor_id` is ON DELETE SET NULL, so deleting the user would
//     otherwise orphan them with a null actor and nothing left to find them by.

import "server-only";

import { randomUUID } from "node:crypto";

import { newPasteId } from "@/lib/ids";
import { prisma } from "@/lib/server/prisma";
import type { User, Viewer } from "@/lib/types";

export interface TestOwner {
  viewer: Viewer;
  userId: string;
  username: string;
}

/** Why a test may be skipped, or null. Mirrors db-test-harness so both read the same. */
export function skipReason(): string | null {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    return "DATABASE_URL is not set — copy .env.example to .env to run the database tests";
  }
  return null;
}

/**
 * Run `body` as a freshly created user, then remove every row that user produced.
 *
 * The user is new for each test rather than shared, which buys isolation for free: a
 * `SELECT count(*) WHERE owner_id = …` is exact regardless of what else is in the table
 * or what another test is doing concurrently. A shared fixture user would make every
 * count assertion depend on test order.
 */
export async function withTestOwner<T>(
  body: (owner: TestOwner) => Promise<T>,
): Promise<T> {
  const username = `t-${randomUUID().slice(0, 12)}`;

  const row = await prisma.user.create({
    data: { username, displayName: "Harness", isModerator: false },
    select: { id: true },
  });

  const user: User = { username, displayName: "Harness", isModerator: false };
  const owner: TestOwner = {
    viewer: { kind: "user", user },
    userId: row.id,
    username,
  };

  try {
    return await body(owner);
  } finally {
    await cleanUp(row.id);
  }
}

/**
 * Remove everything one test user created.
 *
 * Unconditional, in a `finally`: a thrown assertion must not leave rows behind. Each
 * statement is scoped to `userId`, which this process generated moments ago.
 */
async function cleanUp(userId: string): Promise<void> {
  try {
    // The owner's paste ids, read BEFORE anything is deleted. Audit rows are found by
    // subject as well as by actor, and once the pastes are gone neither key exists.
    const pastes = await prisma.paste.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });

    // Audit first — `actor_id` is SET NULL on user delete, so after the user is gone
    // those rows are unreachable by any key the test still holds.
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });

    // And by subject, because THE SWEEPER HAS NO ACTOR. Its `paste.purged` rows are
    // written with `actor_id` null, so deleting by actor never matched them and every
    // sweeper test left one behind permanently — five of them after a single clean run,
    // which is how this was found.
    if (pastes.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { subjectId: { in: pastes.map((p) => p.id) } },
      });
    }

    // Removal requests this user FILED, which may be against another user's paste.
    //
    // `deletion_requests.requester_id` has no cascade — deliberately, because who asked is
    // part of the record and deleting a user should not silently erase it. So a moderator
    // who filed a request about someone else's paste cannot be deleted until the request
    // is, and deleting by `ownerId` below never reaches it. The same shape as
    // `paste_revisions.created_by` in M7.
    //
    // `decided_by` is ON DELETE SET NULL, so a decided request does not need this.
    await prisma.deletionRequest.deleteMany({ where: { requesterId: userId } });

    // Then the pastes, which cascade to revisions, renders, findings and views.
    //
    // Deleting the user first does NOT work, and the reason is a deliberate schema
    // choice rather than an oversight: `paste_revisions.created_by` has no cascade, so
    // it restricts. Authorship is not something a user deletion should be able to
    // silently erase — the revision chain is the audit trail — so the owning paste has
    // to go first and take its revisions with it.
    await prisma.paste.deleteMany({ where: { ownerId: userId } });

    await prisma.user.delete({ where: { id: userId } });
  } catch (error) {
    // Loud, not swallowed. A failed teardown leaves rows in a schema production shares,
    // and the username is the only way to find them — so print it.
    console.error(`FAILED to clean up test user ${userId}`, error);
    throw error;
  }
}

export interface SeedPaste {
  /** Minutes before now. Larger is older, so the newest-first order is predictable. */
  minutesAgo?: number;
  title?: string | null;
  language?: string;
  /** Null for "never". Minutes from now; negative is already expired. */
  expiresInMinutes?: number | null;
  state?: string;
  body?: string;
  id?: string;
  /**
   * Store the body as an object key instead of inline text.
   *
   * Set AT INSERT, because it cannot be set afterwards: the M6 trigger permits exactly one
   * body mutation — the purge — so moving a revision from `body_text` to `storage_key`
   * raises "may only be purged, not rewritten". Which is correct, and is why the create
   * path decides storage from `byte_size` once and never migrates.
   */
  storageKey?: string;
}

/**
 * Insert pastes directly, bypassing the create path.
 *
 * DELIBERATELY NOT `createPaste`, for two reasons that both matter.
 *
 * The rate limit is 20 attempts per minute and is charged on attempts (§4 stage 2), so a
 * pagination test needing 60 rows cannot go through the create path at all — it would
 * spend the bucket and then assert against 429s.
 *
 * And these tests are about reading: ordering, cursors, expiry comparison. Routing them
 * through the scanner and the highlighter would make each one slower and would couple a
 * pagination assertion to the create path's behaviour, so a create-path regression would
 * fail the pagination suite and point at the wrong module.
 *
 * Nothing here is a substitute for the create-path tests, which exercise the real thing.
 */
export async function seedPastes(
  userId: string,
  seeds: SeedPaste[],
): Promise<string[]> {
  // TWO QUERIES, NOT TWO PER ROW. A loop of nested `create` calls was the first version
  // and it timed out the pagination suite at 5 s: ~107 sequential round trips to a hosted
  // database is five seconds of latency, nothing else. `createMany` cannot create nested
  // relations, so the ids are generated here and the revisions reference them.
  const pastes: unknown[] = [];
  const revisions: unknown[] = [];
  const ids: string[] = [];

  for (const [index, seed] of seeds.entries()) {
    const createdAt = new Date(
      Date.now() - (seed.minutesAgo ?? index) * 60_000,
    );

    // `undefined` means "a normal 1-day expiry"; an explicit `null` means never. The two
    // have to stay distinguishable, which is why this is not `??`.
    const expiresAt =
      seed.expiresInMinutes === undefined
        ? new Date(createdAt.getTime() + 24 * 60 * 60_000)
        : seed.expiresInMinutes === null
          ? null
          : new Date(Date.now() + seed.expiresInMinutes * 60_000);

    const body = seed.body ?? `paste ${index}\n`;
    // The real generator, not a slice of a uuid. A hex slice contains `0`, which is
    // not in the base58 alphabet, so those ids fail `isPasteId` — and the proxy refuses
    // a malformed id with a 404 before it ever reaches the database. Seeded data that
    // the application itself would reject makes a test assert against a shape that
    // cannot occur.
    const id = seed.id ?? newPasteId();

    pastes.push({
      id,
      ownerId: userId,
      title: seed.title ?? null,
      language: seed.language ?? "plaintext",
      languageSource: "fallback",
      lineNumbers: false,
      retentionCode: expiresAt === null ? "never" : "1d",
      neverReason: expiresAt === null ? "a test fixture" : null,
      expiresAt,
      purgeAfter:
        expiresAt === null
          ? null
          : new Date(expiresAt.getTime() + 30 * 24 * 60 * 60_000),
      state: seed.state ?? "live",
      createdVia: "web",
      createdAt,
      updatedAt: createdAt,
    });

    revisions.push({
      pasteId: id,
      revisionNo: 1,
      byteSize: new TextEncoder().encode(body).length,
      lineCount: body.replace(/\n$/, "").split("\n").length,
      sha256: "a".repeat(64),
      // Exactly one body pointer, which the M6 CHECK enforces.
      bodyText: seed.storageKey === undefined ? body : null,
      storageKey: seed.storageKey ?? null,
      reason: "original",
      scanState: "complete",
      createdById: userId,
      createdAt,
    });

    ids.push(id);
  }

  await prisma.paste.createMany({ data: pastes as never });
  await prisma.revision.createMany({ data: revisions as never });

  return ids;
}

/** Rows this user owns, for the count assertions the block tests depend on. */
export async function ownedCounts(userId: string): Promise<{
  pastes: number;
  revisions: number;
  renders: number;
  findings: number;
  audit: number;
}> {
  const [pastes, revisions, renders, findings, audit] = await Promise.all([
    prisma.paste.count({ where: { ownerId: userId } }),
    prisma.revision.count({ where: { createdById: userId } }),
    prisma.render.count({
      where: { revision: { paste: { ownerId: userId } } },
    }),
    prisma.secretFinding.count({ where: { paste: { ownerId: userId } } }),
    prisma.auditLog.count({ where: { actorId: userId } }),
  ]);

  return { pastes, revisions, renders, findings, audit };
}

/**
 * A credential-shaped string, assembled at runtime.
 *
 * NEVER a literal. `no-committed-secrets.spec.ts` scans the tracked tree for these
 * shapes, and GitHub push protection rejects them — a committed sample token already
 * blocked a push on this project once. Concatenation keeps the shape out of the file
 * while still producing a real tier-1 match for the scanner.
 */
export function slackTokenShape(): string {
  return ["xoxb", "123456789012", "abcdefghijklmnopqrstuvwx"].join("-");
}

/** An AWS access key id shape, likewise assembled rather than written. */
export function awsKeyShape(): string {
  return `AKIA${"IOSFODNN7EXAMPLE".slice(0, 16)}`;
}
