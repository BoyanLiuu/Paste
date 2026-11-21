// @vitest-environment node

// The create route records where a paste came from, and charges the address (M14, §4 stage 2).
//
// WHAT THIS CATCHES, and why it is a route test rather than a unit one. `createPaste` has
// accepted a `createdIpHash` argument since M6 and the column has had a comment describing
// its salt for just as long — and no caller ever passed a value, so all 1,214 pastes in the
// development database record nothing about their origin. Every piece was correct in
// isolation; the wiring between them did not exist. Only a test that drives the route can
// see that, which is the same seam `sample-links.e2e.ts` exists for.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { rateKey } from "@/lib/http/client-ip";
import { skipReason } from "@/lib/server/create-test-harness";
import { prisma } from "@/lib/server/prisma";
import type { Viewer } from "@/lib/types";

const ORIGIN = "https://paste.test";
const USERNAME = "ip-attribution-route";
const reason = skipReason();

vi.mock("@/lib/server/session", async () => {
  const real = await vi.importActual<typeof import("@/lib/server/viewer")>(
    "@/lib/server/viewer",
  );
  return {
    ...real,
    getViewer: async (): Promise<Viewer> => ({
      kind: "user",
      user: { username: USERNAME, displayName: "IP", isModerator: false },
    }),
  };
});

const { POST } = await import("@/app/api/pastes/route");

/** A plain-text create from a given address, or from none at all. */
function post(ip: string | null, body = "attribution\n"): Request {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain",
    Accept: "text/plain",
  };
  if (ip !== null) headers["x-forwarded-for"] = ip;

  return new Request(`${ORIGIN}/api/pastes`, { method: "POST", headers, body });
}

/** The id out of a `text/plain` 201, which is the whole body. */
async function createdId(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  return (await response.text()).trim().split("/p/")[1];
}

async function cleanUp(): Promise<void> {
  const user = await prisma.user.findUnique({ where: { username: USERNAME } });
  if (user === null) return;
  await prisma.paste.deleteMany({ where: { ownerId: user.id } });
}

describe.skipIf(reason !== null)(
  `the create route's IP attribution${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    beforeEach(cleanUp);

    it("stores a hash of the caller's address", async () => {
      const id = await createdId(await POST(post("203.0.113.7")));

      const row = await prisma.paste.findUniqueOrThrow({
        where: { id },
        select: { createdIpHash: true },
      });

      // Present at all is the assertion that would have failed for six milestones.
      expect(row.createdIpHash).not.toBeNull();
      expect(row.createdIpHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("never stores the address itself", async () => {
      // An IP is personal data and a column of them is a liability with no upside. The
      // column's comment has promised a hash since M6; this is the first thing to check it.
      const id = await createdId(await POST(post("203.0.113.7")));

      const row = await prisma.paste.findUniqueOrThrow({
        where: { id },
        select: { createdIpHash: true },
      });

      expect(row.createdIpHash).not.toContain("203.0.113.7");
      expect(row.createdIpHash).not.toContain("203.0.113");
    });

    it("gives two pastes from one address the same hash, and two addresses different ones", async () => {
      // The property that makes the column useful: it answers "same source?" for a day.
      // A per-request salt would store a unique value per paste and investigate nothing.
      const same = await createdId(await POST(post("203.0.113.7")));
      const sameAgain = await createdId(await POST(post("203.0.113.7")));
      const other = await createdId(await POST(post("198.51.100.4")));

      const rows = await prisma.paste.findMany({
        where: { id: { in: [same, sameAgain, other] } },
        select: { id: true, createdIpHash: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r.createdIpHash]));

      expect(byId.get(same)).toBe(byId.get(sameAgain));
      expect(byId.get(same)).not.toBe(byId.get(other));
    });

    it("still creates a paste when there is no address header", async () => {
      // THE DEVELOPMENT CASE, and the reason a null key is not a refusal on this route:
      // there is no proxy locally, so no header. Treating that as a block would make the
      // create path unusable with `pnpm dev` — the account limit still applies, which is
      // what makes waving it through safe here and unsafe on M15's anonymous path.
      const id = await createdId(await POST(post(null)));

      const row = await prisma.paste.findUniqueOrThrow({
        where: { id },
        select: { createdIpHash: true },
      });
      expect(row.createdIpHash).toBeNull();
    });

    it("charges a bucket for the address", async () => {
      // The other half of M14: the hash is recorded AND the address is throttled. The limit
      // itself is covered in `rate.spec.ts`; this asserts the route reaches it.
      //
      // THE SPECIFIC BUCKET, NOT A GLOBAL COUNT. The first version asserted
      // `count()` had risen, which passed once and then never again: the bucket for this
      // address survives the run, so the second execution adds no row and the assertion
      // failed against working code. A test that only passes on a clean database is a test
      // that will be deleted rather than debugged.
      const key = rateKey(new Headers({ "x-forwarded-for": "203.0.113.9" }));
      expect(key).not.toBeNull();

      const before = await prisma.ipBucket.findUnique({
        where: { ipHash: key! },
      });
      await createdId(await POST(post("203.0.113.9")));
      const after = await prisma.ipBucket.findUniqueOrThrow({
        where: { ipHash: key! },
      });

      // `minute_refilled_at`, AFTER TWO WRONG WITNESSES. The charge statement sets it to
      // `now()` unconditionally, so it moves forward on every successful charge and on
      // nothing else — which is the only property here that holds in every case:
      //
      //   - `minute_tokens` is NOT monotonic. It refills from elapsed time, and this test
      //     takes about four seconds, which restores more than the one token spent. That
      //     read "expected 19 to be less than 19" against a route charging correctly.
      //   - `day_count` is not monotonic either, which took a UTC midnight to discover.
      //     `day_started_at <> today` RESETS it to 1 by design, so a bucket first written
      //     yesterday reads 7 before and 1 after: "expected 1 to be greater than 7",
      //     again against a route that had done its job.
      expect(after.minuteRefilledAt.getTime()).toBeGreaterThan(
        before?.minuteRefilledAt.getTime() ?? 0,
      );
    });
  },
);
