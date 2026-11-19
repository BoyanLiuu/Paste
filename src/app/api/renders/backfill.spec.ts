// @vitest-environment node

// The backfill (ARCHITECTURE N2, §6.2), and the reason it is a cron endpoint.
//
// This is the "Option D" half of M8's design decision: a render can be missing for a
// paste that should have one — the save-time render failed, or a theme changed, or Shiki
// was upgraded — and N2 forbids fixing that on a read. So it is fixed out of band, and
// the view page announces the gap until it has been.
//
// The two failures worth a test are both about what this must NOT do: render a paste
// whose bytes were purged, and run for anyone who asks.

import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/renders/route";
import { THEME_NAME } from "@/lib/render/highlight";
import {
  seedPastes,
  skipReason,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { prisma } from "@/lib/server/prisma";

const reason = skipReason();
const SECRET = "test-cron-secret";

function request(auth?: string): Request {
  return new Request("http://localhost:3025/api/renders", {
    method: "POST",
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

async function withSecret<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
}

describe.skipIf(reason !== null)(
  `the render backfill${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("refuses without the cron secret", async () => {
      await withSecret(async () => {
        // An unauthenticated endpoint that invokes a highlighter is a way to make the
        // server do unbounded WASM work on demand — the exact cost N2 exists to control.
        expect((await POST(request())).status).toBe(401);
        expect((await POST(request("Bearer wrong"))).status).toBe(401);
        // Not accepted as a bare token either, which is the shape someone reaching for
        // this endpoint by hand would try first.
        expect((await POST(request(SECRET))).status).toBe(401);
      });
    });

    it("fails closed when no secret is configured", async () => {
      const previous = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;
      try {
        // Refuses rather than running unauthenticated. An endpoint that becomes public
        // when a variable is unset is worse than one that is simply broken, because
        // nothing fails until someone finds it.
        expect((await POST(request("Bearer anything"))).status).toBe(503);
      } finally {
        if (previous !== undefined) process.env.CRON_SECRET = previous;
      }
    });

    it("renders a revision that has no render, and is idempotent", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const [id] = await seedPastes(owner.userId, [
            { language: "python", body: "def f():\n    return 1\n" },
          ]);

          // Asserted on THIS paste, never on the global counters.
          //
          // The endpoint is global by design — it backfills whatever is missing, which is
          // what a cron job should do — so its `rendered` count includes rows other test
          // files created moments earlier. Asserting on it made this test pass or fail
          // depending on which files vitest happened to schedule alongside it.
          await POST(request(`Bearer ${SECRET}`));

          const render = await prisma.render.findFirst({
            where: { revision: { pasteId: id }, theme: THEME_NAME },
          });
          expect(render).not.toBeNull();
          // The same CSP-safe markup the save-time renderer produces — one shared
          // highlighter, so the two cannot drift into different class vocabularies.
          expect(render!.html).not.toContain('style="');
          expect(render!.html).toMatch(/\btk-[a-z-]+\b/);

          // A second run must not re-render what it just did. Cron calls this
          // repeatedly, and re-rendering every paste on every run is the difference
          // between a backfill and a load generator. Measured as "still exactly one row
          // for this revision", which holds regardless of what else is in the table.
          const htmlBefore = render!.html;
          await POST(request(`Bearer ${SECRET}`));

          const after = await prisma.render.findMany({
            where: { revision: { pasteId: id }, theme: THEME_NAME },
          });
          expect(after).toHaveLength(1);
          expect(after[0].html).toBe(htmlBefore);
        });
      });
    });

    it("never renders a purged revision", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          const [id] = await seedPastes(owner.userId, [
            { language: "python", body: "def f():\n    return 1\n" },
          ]);

          // Purge it the way the sweeper does: both pointers to NULL with `purged_at`
          // set, which is the only body mutation the M6 trigger permits.
          await prisma.revision.updateMany({
            where: { pasteId: id },
            data: { bodyText: null, storageKey: null, purgedAt: new Date() },
          });

          await POST(request(`Bearer ${SECRET}`));

          // Nothing to render, and nothing that could bring the bytes back. A backfill
          // that resurrected purged content would defeat the takedown it followed.
          const renders = await prisma.render.count({
            where: { revision: { pasteId: id } },
          });
          expect(renders).toBe(0);
        });
      });
    });

    it("skips a body above the highlight threshold rather than failing on it", async () => {
      await withTestOwner(async (owner) => {
        await withSecret(async () => {
          // Over 2 000 lines: no render by design (§6.2), and the view page shows the
          // "highlighting is off" banner with the line count. Reported as skipped, not
          // failed, so a backlog of large logs does not look like a broken job.
          const [id] = await seedPastes(owner.userId, [
            { body: `${"line\n".repeat(2_500)}` },
          ]);

          const result = (await (
            await POST(request(`Bearer ${SECRET}`))
          ).json()) as { skipped: number; failed: string[] };

          // `failed` is empty rather than `skipped` being a particular number: a backlog
          // of large logs must not look like a broken job, and the count is global.
          //
          // This assertion earned itself. It caught a real race: the batch is read once
          // and each body then takes a Shiki render, so a revision deleted inside that
          // window made the insert fail on a foreign key and get logged as a failure —
          // which in production is an operator chasing a job that is working correctly.
          // Those are now counted as skipped.
          expect(result.failed).toEqual([]);
          const renders = await prisma.render.count({
            where: { revision: { pasteId: id } },
          });
          expect(renders).toBe(0);
        });
      });
    });
  },
);
