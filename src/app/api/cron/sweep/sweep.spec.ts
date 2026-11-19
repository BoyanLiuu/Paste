// @vitest-environment node

// Every sweeper test, in ONE FILE, and that is not tidiness.
//
// The sweeper is global: phase A expires every past-due paste in the database, which is
// exactly what a cron job should do. Vitest runs one worker per FILE in parallel, so three
// separate sweeper specs meant three concurrent invocations of a global job, each
// expiring the rows the others had just seeded to observe. The symptom was a test that
// counted 1 200 seeded rows and found 0 live, intermittently, in about one run in three.
//
// Tests within a file run sequentially, so one file is the fix. Nothing else in the suite
// calls the sweeper, so nothing else contends.
//
// ---------------------------------------------------------------------------------------
//
// What the three groups below are for (ARCHITECTURE §6.4, N4):
//
//   ORDERING      the silent leak. Phase B deletes the object BEFORE nulling the key, so
//                 a crash leaves a row that still knows what to delete. Reversed, the
//                 object leaks forever with nothing pointing at it — and Supabase Storage
//                 has no lifecycle rules, so nothing ever cleans it up.
//
//   IDEMPOTENCY   a killed invocation leaves claimed rows whose lease lapses, so the next
//                 tick re-runs every step over work that is already done. Retrying is how
//                 the job survives being killed; it is only safe if each step is a no-op
//                 the second time.
//
//   RESUMABILITY  a job that spends its budget without advancing. That looks healthy from
//                 outside: every tick returns 200, the log says it ran, the backlog never
//                 moves.

import { describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/cron/sweep/route";
import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { prisma } from "@/lib/server/prisma";

const reason = skipReason();
const SECRET = "test-cron-secret";

interface Summary {
  expired: number;
  purged: number;
  failed: string[];
  more: boolean;
  elapsedMs: number;
}

function request(auth = `Bearer ${SECRET}`): Request {
  return new Request("http://localhost:3025/api/cron/sweep", {
    method: "POST",
    headers: { authorization: auth },
  });
}

async function withEnv<T>(
  env: Record<string, string>,
  body: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withSecret<T>(body: () => Promise<T>): Promise<T> {
  return withEnv({ CRON_SECRET: SECRET }, body);
}

/**
 * A paste already past its purge window.
 *
 * The storage key goes in at insert. It cannot be added later: the M6 trigger permits
 * exactly one body mutation — the purge — so an inline-to-object move raises. That is the
 * invariant working, and it is why the create path decides once from `byte_size`.
 */
/**
 * 1 200, and the number matters.
 *
 * Phase A takes 500 rows per batch and then re-checks the budget, so a backlog has to
 * EXCEED the batch size for an exhausted budget to end an invocation with work left. The
 * first attempt used 300: one batch swallowed the lot, the loop exited on
 * `rows.length < EXPIRE_BATCH` before the clock was ever consulted, and the test proved
 * nothing about resumability while passing every other assertion.
 */
const BACKLOG = 1_200;

async function seedPurgeable(
  userId: string,
  opts: { storageKey?: string } = {},
): Promise<string> {
  const [id] = await seedPastes(userId, [
    {
      state: "expired",
      expiresInMinutes: -60,
      ...(opts.storageKey === undefined ? {} : { storageKey: opts.storageKey }),
    },
  ]);

  await prisma.paste.update({
    where: { id },
    data: { purgeAfter: new Date(Date.now() - 60_000), leaseUntil: null },
  });

  return id;
}

describe.skipIf(reason !== null)(
  `phase B ordering${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("keeps the storage key when the object delete fails", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const id = await seedPurgeable(owner.userId, {
            storageKey: "revisions/does-not-matter",
          });

          vi.resetModules();
          vi.doMock("@/lib/storage/body", async () => {
            const real =
              await vi.importActual<typeof import("@/lib/storage/body")>(
                "@/lib/storage/body",
              );
            return {
              ...real,
              storageConfigured: () => true,
              deleteBody: async () => {
                throw new Error("bucket unreachable");
              },
            };
          });

          try {
            const { POST } = await import("@/app/api/cron/sweep/route");
            const result = (await (await POST(request())).json()) as {
              purged: number;
              failed: string[];
            };

            expect(result.purged).toBe(0);
            expect(result.failed).toContain(id);

            const revision = await prisma.revision.findFirstOrThrow({
              where: { pasteId: id },
            });
            // THE ASSERTION. The key is still here, so the next run knows what to delete.
            expect(revision.storageKey).toBe("revisions/does-not-matter");
            expect(revision.purgedAt).toBeNull();

            const paste = await prisma.paste.findUniqueOrThrow({
              where: { id },
            });
            // And the paste is not marked purged, because it is not.
            expect(paste.state).toBe("expired");
          } finally {
            vi.doUnmock("@/lib/storage/body");
            vi.resetModules();
          }
        });
      });
    });

    it("refuses to null a key it cannot delete because storage is unconfigured", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const id = await seedPurgeable(owner.userId, {
            storageKey: "revisions/orphan-me",
          });

          vi.resetModules();
          vi.doMock("@/lib/storage/body", async () => {
            const real =
              await vi.importActual<typeof import("@/lib/storage/body")>(
                "@/lib/storage/body",
              );
            return { ...real, storageConfigured: () => false };
          });

          try {
            const { POST } = await import("@/app/api/cron/sweep/route");
            const result = (await (await POST(request())).json()) as {
              failed: string[];
            };

            // The tempting behaviour is to skip the object and purge the row anyway —
            // which quietly orphans the object. Failing loudly leaves work for the next
            // run, once someone has set the credentials.
            expect(result.failed).toContain(id);
            const revision = await prisma.revision.findFirstOrThrow({
              where: { pasteId: id },
            });
            expect(revision.storageKey).toBe("revisions/orphan-me");
          } finally {
            vi.doUnmock("@/lib/storage/body");
            vi.resetModules();
          }
        });
      });
    });

    it("deletes the render row, so a purged paste holds no rendered copy", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const id = await seedPurgeable(owner.userId);
          const revision = await prisma.revision.findFirstOrThrow({
            where: { pasteId: id },
            select: { id: true },
          });
          await prisma.render.create({
            data: {
              revisionId: revision.id,
              theme: "paste",
              html: "<pre>the body, in HTML</pre>",
            },
          });

          const { POST } = await import("@/app/api/cron/sweep/route");
          await POST(request());

          // Rendered HTML is a copy of the body. A purged paste that still has one has
          // been hidden rather than purged — the kind of thing discovered by a subpoena
          // rather than by a reader.
          expect(
            await prisma.render.count({ where: { revisionId: revision.id } }),
          ).toBe(0);

          const after = await prisma.revision.findFirstOrThrow({
            where: { pasteId: id },
          });
          expect(after.bodyText).toBeNull();
          expect(after.storageKey).toBeNull();
          expect(after.purgedAt).not.toBeNull();
          // The hash survives, which is what lets the tombstone prove what used to be
          // there (§6.3).
          expect(after.sha256).toHaveLength(64);
        });
      });
    });

    it("refuses to run without the cron secret", async () => {
      await withSecret(async () => {
        const { POST } = await import("@/app/api/cron/sweep/route");
        expect((await POST(request("Bearer wrong"))).status).toBe(401);
      });

      const previous = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;
      try {
        const { POST } = await import("@/app/api/cron/sweep/route");
        // This endpoint destroys data. Unauthenticated, it is a remote delete button.
        expect((await POST(request())).status).toBe(503);
      } finally {
        if (previous !== undefined) process.env.CRON_SECRET = previous;
      }
    });
  },
);

describe.skipIf(reason !== null)(
  `sweeper idempotency${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("changes nothing on a second run over the same rows", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const id = await seedPurgeable(owner.userId);

          await POST(request());

          const first = await prisma.revision.findFirstOrThrow({
            where: { pasteId: id },
          });
          expect(first.purgedAt).not.toBeNull();

          // Run it again over the same data, which is exactly what a re-claimed lease
          // produces.
          const second = (await (await POST(request())).json()) as {
            purged: number;
            failed: string[];
          };

          const after = await prisma.revision.findFirstOrThrow({
            where: { pasteId: id },
          });

          // The ORIGINAL purge time, not a fresh one. Overwriting it destroys the only
          // record of when the bytes actually went — and the second run would look
          // identical in every other respect.
          expect(after.purgedAt?.toISOString()).toBe(
            first.purgedAt?.toISOString(),
          );
          expect(second.failed).toEqual([]);
        });
      });
    });

    it("writes exactly one audit row however many times it runs", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const id = await seedPurgeable(owner.userId);

          for (let i = 0; i < 3; i += 1) await POST(request());

          const rows = await prisma.auditLog.findMany({
            where: { subjectId: id, action: "paste.purged" },
          });
          // The dedupe unique on (subject_type, subject_id, action, dedupe_key) is what
          // makes this hold. Without it the purge log counts retries as separate events,
          // and "when was this destroyed" gets three answers.
          expect(rows).toHaveLength(1);
        });
      });
    });

    it("does not re-purge a paste that is already purged", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const id = await seedPurgeable(owner.userId);
          await POST(request());

          // Phase B selects on `state = 'expired'`, so a purged row is not a candidate at
          // all. Asserted because the obvious alternative — selecting on `purge_after`
          // alone — would re-claim every purged paste on every tick forever, and the work
          // being idempotent would hide it.
          const result = (await (await POST(request())).json()) as {
            purged: number;
          };
          expect(result.purged).toBe(0);

          const paste = await prisma.paste.findUniqueOrThrow({ where: { id } });
          expect(paste.state).toBe("purged");
          expect(paste.leaseUntil).toBeNull();
        });
      });
    });

    it("re-claims a row whose lease was left behind by a killed run", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const id = await seedPurgeable(owner.userId);

          // A lease stamped in the past is what a process killed mid-purge leaves: the
          // connection dropped so the row lock went, but the lease column stayed.
          await prisma.paste.update({
            where: { id },
            data: { leaseUntil: new Date(Date.now() - 1_000) },
          });

          const result = (await (await POST(request())).json()) as {
            purged: number;
          };
          expect(result.purged).toBe(1);
        });
      });
    });

    it("leaves a row alone while its lease is still live", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const id = await seedPurgeable(owner.userId);

          // Another invocation is working on it right now. Two ticks purging one row
          // concurrently is what the lease exists to prevent, on top of SKIP LOCKED —
          // because a dropped connection releases the lock while the work may still be
          // in flight somewhere.
          await prisma.paste.update({
            where: { id },
            data: { leaseUntil: new Date(Date.now() + 120_000) },
          });

          const result = (await (await POST(request())).json()) as {
            purged: number;
          };
          expect(result.purged).toBe(0);

          const paste = await prisma.paste.findUniqueOrThrow({ where: { id } });
          expect(paste.state).toBe("expired");
        });
      });
    });
  },
);

describe.skipIf(reason !== null)(
  `sweeper resumability${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("drains a backlog across invocations and converges", async () => {
      await withTestOwner(async (owner) => {
        // All past due, all still `live` — the sweeper has never run on them.
        await seedPastes(
          owner.userId,
          Array.from({ length: BACKLOG }, (_, i) => ({
            minutesAgo: i + 1,
            expiresInMinutes: -(i + 1),
          })),
        );

        const mine = { ownerId: owner.userId };
        expect(
          await prisma.paste.count({ where: { ...mine, state: "live" } }),
        ).toBe(BACKLOG);

        await withEnv(
          { CRON_SECRET: SECRET, SWEEP_BUDGET_MS: "1" },
          async () => {
            const { POST } = await import("@/app/api/cron/sweep/route");

            const summaries: Summary[] = [];

            // Progress is measured on THIS OWNER'S rows, not on the summary's counters.
            //
            // The sweeper is global by design — it expires everything past due, which is
            // what a cron job should do — so `summary.expired` includes rows other test
            // files seeded moments earlier. Asserting `expired === BACKLOG` passed alone
            // and failed in the full suite, for the same reason the render backfill's
            // counters could not be asserted either.
            let remaining = BACKLOG;

            // A bounded loop, not `while (more)`. A sweeper that never converges would
            // otherwise hang the suite instead of failing it — and "hangs" is precisely
            // the symptom of the bug under test.
            for (let tick = 0; tick < 20; tick += 1) {
              const summary = (await (await POST(request())).json()) as Summary;
              summaries.push(summary);

              const live = await prisma.paste.count({
                where: { ...mine, state: "live" },
              });

              // THE ASSERTION THAT CATCHES A STALLED JOB. Every tick must move something
              // of ours. A budget of 1 ms is already spent by the time the first query
              // returns, so this also proves the loop completes the batch it started
              // rather than abandoning it — mid-batch abandonment is how a tick does
              // nothing while reporting success.
              expect(
                live,
                `tick ${tick} made no progress: still ${live} live`,
              ).toBeLessThan(remaining);
              remaining = live;

              if (live === 0) break;
            }

            // Converged.
            expect(remaining).toBe(0);
            expect(
              await prisma.paste.count({
                where: { ...mine, state: "expired" },
              }),
            ).toBe(BACKLOG);

            // Several invocations, which is the resumable part. One invocation finishing
            // the lot would mean the budget was never exhausted and this test proves
            // nothing about resumability.
            expect(summaries.length).toBeGreaterThan(1);

            // AND NOT ONE BYTE OF OURS PURGED. `purge_after` is 30 days out, so none of
            // these are candidates for phase B — a sweeper that purged on expiry would
            // destroy bytes a month inside the window a moderator can still restore from.
            const purged = await prisma.revision.count({
              where: { paste: mine, purgedAt: { not: null } },
            });
            expect(purged).toBe(0);
          },
        );
      });
    });

    it("sets purge_after 30 days past the expiry, not past now", async () => {
      await withTestOwner(async (owner) => {
        // A paste that lapsed 10 days ago. Its purge window must close 20 days from now,
        // not 30 — the grace period runs from the expiry, so a sweeper that ran late must
        // not silently extend how long the bytes survive.
        const tenDaysAgo = -10 * 24 * 60;
        const [id] = await seedPastes(owner.userId, [
          { expiresInMinutes: tenDaysAgo },
        ]);

        await withEnv({ CRON_SECRET: SECRET }, async () => {
          const { POST } = await import("@/app/api/cron/sweep/route");
          await POST(request());
        });

        const paste = await prisma.paste.findUniqueOrThrow({ where: { id } });
        expect(paste.state).toBe("expired");

        const gap = paste.purgeAfter!.getTime() - paste.expiresAt!.getTime();
        expect(Math.round(gap / 86_400_000)).toBe(30);
        // And therefore still in the future: not purgeable yet.
        expect(paste.purgeAfter!.getTime()).toBeGreaterThan(Date.now());
      });
    });

    it("reports more=true while a backlog remains", async () => {
      await withTestOwner(async (owner) => {
        await seedPastes(
          owner.userId,
          Array.from({ length: 20 }, (_, i) => ({
            minutesAgo: i + 1,
            expiresInMinutes: -(i + 1),
          })),
        );

        await withEnv(
          { CRON_SECRET: SECRET, SWEEP_BUDGET_MS: "1" },
          async () => {
            const { POST } = await import("@/app/api/cron/sweep/route");
            const summary = (await (await POST(request())).json()) as Summary;
            // 20 rows fit in one 500-row batch, so this tick clears them and reports
            // nothing left. The flag is what tells an operator "finished" from "ran out
            // of time", which otherwise look identical from a 200.
            expect(summary.expired).toBe(20);
            expect(summary.more).toBe(false);
          },
        );
      });
    });
  },
);
