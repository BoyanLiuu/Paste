// @vitest-environment node

// The threshold applied to the wrong unit (ARCHITECTURE §6.2).
//
// 512 KB is a count of BYTES, not characters. UTF-8 spends up to four bytes on a code
// point, so a character-based check lets roughly 2 MB of CJK or emoji through a 512 KB
// gate — and the failure arrives as a Postgres row-size error on whichever paste happens
// to be next, not on the one that was too big.
//
// The unit tests below need no credentials. The round-trip tests do, and they skip with a
// printed reason rather than failing: a fresh clone has no bucket, and a database test
// that cannot run should say so rather than look green.

import { describe, expect, it } from "vitest";

import {
  OBJECT_STORAGE_BYTES,
  storageFor,
  TRUNCATE_LINES,
} from "@/lib/render/thresholds";
import { skipReason } from "@/lib/server/create-test-harness";
import {
  bodyKey,
  BodyUnavailable,
  BUCKET,
  deleteBody,
  getBody,
  putBody,
  storageConfigured,
} from "@/lib/storage/body";

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("the storage threshold", () => {
  it("counts bytes, not characters", () => {
    // 200 000 CJK characters: well under 512 000 by character count, well over it by
    // bytes. A `body.length > OBJECT_STORAGE_BYTES` check calls this inline.
    const cjk = "字".repeat(200_000);
    expect(cjk.length).toBeLessThan(OBJECT_STORAGE_BYTES);
    expect(bytes(cjk)).toBeGreaterThan(OBJECT_STORAGE_BYTES);
    expect(storageFor(bytes(cjk))).toBe("object");
  });

  it("keeps a body exactly at the threshold inline", () => {
    // `>` and not `>=`: the threshold is the largest size that stays in Postgres, and an
    // off-by-one here moves a whole band of pastes into object storage for no reason.
    expect(storageFor(OBJECT_STORAGE_BYTES)).toBe("postgres");
    expect(storageFor(OBJECT_STORAGE_BYTES + 1)).toBe("object");
  });

  it("keys objects on the revision, not the paste", () => {
    // A revision's bytes are immutable (§6.3), so the key never needs rewriting and a
    // supersession writes a new object instead of overwriting one. Keying on the paste id
    // would make the second revision's upload clobber the first's bytes — which the M6
    // trigger could not catch, because it only guards the database.
    expect(bodyKey("abc-123")).toBe("revisions/abc-123");
    expect(bodyKey("abc-123")).not.toContain(BUCKET);
  });
});

const storageReason =
  skipReason() ??
  (storageConfigured()
    ? null
    : "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set — see .env.example");

describe.skipIf(storageReason !== null)(
  `object round-trip${storageReason ? ` (skipped: ${storageReason})` : ""}`,
  () => {
    it("stores and returns a body over the threshold byte-for-byte", async () => {
      const id = `test-${Date.now()}`;
      // Just over 512 KB, with line structure so the truncation assertion below is real.
      const body = `${"x".repeat(80)}\n`.repeat(7_000);
      expect(bytes(body)).toBeGreaterThan(OBJECT_STORAGE_BYTES);

      const key = await putBody(id, body);
      try {
        // Byte-for-byte. A transport that re-encoded or normalised newlines would break
        // the sha256 the tombstone publishes, so a local copy could never be verified.
        expect(await getBody(key)).toBe(body);
      } finally {
        await deleteBody(key);
      }
    });

    it("reports a deleted object as deleted, twice", async () => {
      const id = `test-idem-${Date.now()}`;
      const key = await putBody(id, "small\n");

      // Idempotent, and §6.4 depends on it: phase B deletes the object before nulling the
      // key, so a killed invocation re-runs the delete on a key whose object is already
      // gone. If that reported failure the row could never finish purging.
      expect(await deleteBody(key)).toBe(true);
      expect(await deleteBody(key)).toBe(true);
      // Reading a deleted object THROWS rather than returning null. It returned null at
      // first, which collapsed "object gone" together with "storage unreachable" and
      // "credentials wrong" — and the read path then rendered an empty `<pre>` and told
      // the reader, with a 200, that the snippet was empty. A live revision's object must
      // exist, so a missing one is an anomaly and a 500 is the honest report.
      await expect(getBody(key)).rejects.toThrow(BodyUnavailable);
    });

    it("refuses to overwrite an existing key", async () => {
      const id = `test-clobber-${Date.now()}`;
      const key = await putBody(id, "first\n");
      try {
        // `upsert: false`. The key holds a fresh uuid, so a collision means a revision id
        // is being reused — which would silently replace one revision's bytes with
        // another's. Better to fail.
        await expect(putBody(id, "second\n")).rejects.toThrow();
        expect(await getBody(key)).toBe("first\n");
      } finally {
        await deleteBody(key);
      }
    });

    it("truncates for display while keeping the whole body retrievable", async () => {
      const id = `test-trunc-${Date.now()}`;
      const lines = 3_000;
      const body = `${"y".repeat(60)}\n`.repeat(lines);

      const key = await putBody(id, body);
      try {
        const whole = await getBody(key);
        // The raw endpoint serves every byte; only the rendered view truncates. Someone
        // piping this into a file must get the lot.
        expect(whole.split("\n").length).toBe(lines + 1);
        expect(lines).toBeGreaterThan(TRUNCATE_LINES);
      } finally {
        await deleteBody(key);
      }
    });
  },
);
