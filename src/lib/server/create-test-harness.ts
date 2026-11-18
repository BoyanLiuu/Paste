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
    // Audit first — `actor_id` is SET NULL on user delete, so after the user is gone
    // these rows are unreachable by any key the test still holds.
    await prisma.auditLog.deleteMany({ where: { actorId: userId } });

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
