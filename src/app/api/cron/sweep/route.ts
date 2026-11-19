// POST /api/cron/sweep — the two-phase sweeper (ARCHITECTURE §6.4).
//
// Expiry is enforced on read, so this job's deadline is measured in DAYS. That is the
// whole reason it can be a daily tick and can stop halfway: a paste whose expiry passed
// four seconds ago is already gone to every reader (§6.3), and this only converges the
// stored state and destroys the bytes.
//
//   PHASE A  logical expiry, metadata only. Cheap, batched, loops until done.
//   PHASE B  physical purge. Deletes bytes, so it is small, leased and strictly ordered.
//
// THE ORDERING IN PHASE B IS NOT NEGOTIABLE, and it is the part that fails silently:
//
//   1. delete the object        before the key is lost
//   2. null the body pointers   the M6 trigger permits exactly this one body mutation
//   3. delete the render row    rendered HTML is a copy of the body
//   4. mark the paste purged    and release the lease
//   5. write the audit row      idempotent via the dedupe unique
//
// Reversed — null the key first, then crash — and the object leaks forever with nothing
// left that records its existence. Step 3 matters just as much: a purged paste that still
// holds its rendered HTML has been hidden rather than purged, which is the kind of bug
// found by a subpoena rather than by a test.
//
// Every step is idempotent because a killed invocation leaves a leased row that is
// re-claimed when the lease lapses: deleting a deleted object succeeds, nulling a null
// column is a no-op, and the audit insert is keyed on
// (subject_type, subject_id, action, dedupe_key).

import { NextResponse } from "next/server";

import { record } from "@/lib/audit";
import { prisma } from "@/lib/server/prisma";
import { deleteBody, storageConfigured } from "@/lib/storage/body";

/** Hard ceiling for the function. Vercel's limit for this plan is 300 s. */
export const maxDuration = 300;

/**
 * Wall clock the loops respect, leaving headroom to write a summary and return.
 *
 * READ PER REQUEST, not at module load. The first version was a module-level `const`, and
 * that is wrong twice over: in a serverless runtime it freezes the value at whichever cold
 * start happened to import the module, so changing the variable does nothing until the
 * instance recycles — and the resumability test below set the variable after the import
 * and silently got the default, so a one-millisecond budget finished 1 200 rows in a
 * single invocation and the test failed on the symptom rather than the cause.
 *
 * Bounded below `maxDuration` so the function always gets to return its summary. A job
 * killed by the platform reports nothing, which is the one outcome that makes a backlog
 * invisible.
 */
function budgetMs(): number {
  return Math.min(290_000, Number(process.env.SWEEP_BUDGET_MS ?? "240000"));
}

/** Phase A is metadata only, so it can take big bites. */
const EXPIRE_BATCH = 500;

/** Phase B destroys bytes and talks to object storage, so it takes small ones. */
const PURGE_BATCH = 50;

/** How long a claimed row stays claimed. Long enough for one row's work, short enough
 *  that a killed invocation's rows are retried on the next tick rather than next week. */
const LEASE_SECONDS = 120;

interface Summary {
  expired: number;
  purged: number;
  failed: string[];
  /** True when the budget ran out with work still to do, so the next tick should hurry. */
  more: boolean;
  elapsedMs: number;
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    // Fail closed. This endpoint destroys data; an unauthenticated version of it is a
    // remote delete button.
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing to run." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const started = Date.now();
  const budget = budgetMs();
  const spent = () => Date.now() - started;
  const summary: Summary = {
    expired: 0,
    purged: 0,
    failed: [],
    more: false,
    elapsedMs: 0,
  };

  // ---------------------------------------------------------------- phase A
  //
  // `FOR UPDATE SKIP LOCKED` so two overlapping ticks never choose the same rows. Without
  // it, a slow tick and the next one would both claim the same batch and the second would
  // block on the first's locks until it timed out — a sweeper that stalls under exactly
  // the backlog it exists to clear.
  // `do`, not `while`: EVERY INVOCATION ATTEMPTS AT LEAST ONE BATCH.
  //
  // A plain `while (spent() < budget)` can exit before running once — the auth check and
  // a clock read are enough to exhaust a very small budget — so the job returns having
  // done nothing while reporting there is more to do. That is precisely the stalled
  // sweeper this design is meant to rule out, and it showed up as a test that passed
  // alone and failed in the full suite, where everything is a millisecond slower.
  //
  // Guaranteeing one batch means a misconfigured budget drains a backlog slowly instead
  // of never.
  do {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE paste.pastes
         SET state = 'expired',
             purge_after = expires_at + interval '30 days',
             updated_at = now()
       WHERE id IN (
         SELECT id FROM paste.pastes
          WHERE state = 'live' AND expires_at IS NOT NULL AND expires_at <= now()
          ORDER BY expires_at
          LIMIT ${EXPIRE_BATCH}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id`;

    summary.expired += rows.length;
    if (rows.length < EXPIRE_BATCH) break;
  } while (spent() < budget);

  // ---------------------------------------------------------------- phase B
  //
  // Claim rows by stamping a lease, in one statement, so the claim is committed before any
  // destruction begins. A plain SELECT then UPDATE would let a crash between the two leave
  // rows that look unclaimed while their objects are already gone.
  do {
    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE paste.pastes
         SET lease_until = now() + ${`${LEASE_SECONDS} seconds`}::interval
       WHERE id IN (
         SELECT id FROM paste.pastes
          WHERE state = 'expired'
            AND purge_after IS NOT NULL
            AND purge_after <= now()
            -- A lapsed lease is a row some earlier invocation died holding. Re-claiming it
            -- is the whole point: the work is idempotent, so retrying is always safe.
            AND (lease_until IS NULL OR lease_until <= now())
          ORDER BY purge_after
          LIMIT ${PURGE_BATCH}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id`;

    if (claimed.length === 0) break;

    for (const [index, { id }] of claimed.entries()) {
      // One row always, for the same forward-progress reason. A purge that is never
      // attempted is a paste whose bytes live forever.
      if (index > 0 && spent() >= budget) {
        summary.more = true;
        break;
      }
      try {
        await purgeOne(id);
        summary.purged += 1;
      } catch (error) {
        // One row's failure must not abandon the rest, and the lease lapses on its own so
        // the next tick retries it. Releasing the lease here would be wrong: a row that
        // just failed should wait rather than be retried immediately in a tight loop.
        summary.failed.push(id);
        console.error(`sweep: purge failed for paste ${id}`, error);
      }
    }

    if (claimed.length < PURGE_BATCH) break;
  } while (spent() < budget);

  // Did phase A leave anything? Reported so an operator can tell "finished" from "ran out
  // of time", which otherwise look identical from a 200.
  const remaining = await prisma.paste.count({
    where: { state: "live", expiresAt: { not: null, lte: new Date() } },
  });
  summary.more = summary.more || remaining > 0;
  summary.elapsedMs = spent();

  console.log(
    `sweep: ${summary.expired} expired, ${summary.purged} purged, ` +
      `${summary.failed.length} failed, more=${summary.more}, ${summary.elapsedMs}ms`,
  );

  // 200 with a summary either way, including when nothing was found. A cron job that
  // returns an error for "nothing to do" trains whoever watches it to ignore the alerts.
  return NextResponse.json(summary);
}

/**
 * Purge one paste, in the order §6.4 fixes.
 *
 * Not one transaction, and deliberately. Object storage is not in the database, so a
 * transaction cannot cover step 1 — and wrapping steps 2–5 in one while step 1 sits
 * outside buys nothing except the illusion that it does. What makes this safe is that
 * every step is idempotent and the order is such that a crash at any point leaves a state
 * the next run can finish from.
 */
async function purgeOne(pasteId: string): Promise<void> {
  const revisions = await prisma.revision.findMany({
    where: { pasteId },
    select: { id: true, storageKey: true, purgedAt: true },
  });

  for (const revision of revisions) {
    // 1. THE OBJECT FIRST. While the key is still recorded, so a crash here leaves a row
    //    that still knows what to delete. Nulling first and crashing orphans the object
    //    with nothing pointing at it — and Supabase Storage has no lifecycle rules, so
    //    nothing else would ever clean it up (which is why phase C exists as a backstop).
    if (revision.storageKey !== null) {
      if (!storageConfigured()) {
        throw new Error(
          `paste ${pasteId} has a stored object but storage is not configured; ` +
            "refusing to null the key and orphan it",
        );
      }
      if (!(await deleteBody(revision.storageKey))) {
        throw new Error(`could not delete object ${revision.storageKey}`);
      }
    }

    // 2. Now the pointers. This is the only body mutation the M6 trigger permits, and it
    //    requires both pointers null with `purged_at` set — a partial version raises.
    //    Skipped when already purged so a retry does not rewrite `purged_at` and lose the
    //    original time.
    if (revision.purgedAt === null) {
      await prisma.revision.update({
        where: { id: revision.id },
        data: { bodyText: null, storageKey: null, purgedAt: new Date() },
      });
    }

    // 3. The render, which is a copy of the body in HTML. A purged paste that still has
    //    one has been hidden, not purged.
    await prisma.render.deleteMany({ where: { revisionId: revision.id } });
  }

  // 4. Mark it and release the lease.
  await prisma.paste.update({
    where: { id: pasteId },
    data: { state: "purged", leaseUntil: null },
  });

  // 5. The record that it happened. Last, because it describes completed work — and
  //    idempotent, so a re-claimed row does not write a second row for one purge.
  //
  //    `actorId` is null and stays null: the sweeper is nobody. Attributing a scheduled
  //    purge to a person would be a lie in the one record meant to be trusted. The paste
  //    id alone is a safe dedupe key here for the same reason — there is no actor to
  //    distinguish, and only one purge can ever happen per paste.
  await record({
    action: "paste.purged",
    subjectType: "paste",
    subjectId: pasteId,
    dedupeKey: pasteId,
    payload: { revisions: revisions.length, by: "sweeper" },
  });
}
