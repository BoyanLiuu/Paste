import { describe, expect, it, vi } from "vitest";

import {
  ID_LENGTH,
  isPasteId,
  MAX_ID_ATTEMPTS,
  newPasteId,
  withFreshId,
} from "@/lib/ids";

// The id is the access control for an unlisted paste (ARCHITECTURE §1.3), so these are
// security tests rather than formatting ones.

describe("paste ids", () => {
  it("avoids the characters people transcribe wrongly", () => {
    // 0/O and 1/I/l are the pairs that get misread off a screen or misheard over a call.
    // A transcription error must land on "no such paste" rather than on someone else's.
    const ids = Array.from({ length: 2000 }, newPasteId).join("");
    expect(ids).not.toMatch(/[0OIl]/);
  });

  it("is the declared length and validates as one", () => {
    for (let i = 0; i < 200; i += 1) {
      const id = newPasteId();
      expect(id).toHaveLength(ID_LENGTH);
      expect(isPasteId(id)).toBe(true);
    }
  });

  it("does not bias the alphabet, which would shrink the id space", () => {
    // The bug this catches is `randomBytes(1)[0] % 58`, which is the obvious
    // implementation and is biased: 256 is not a multiple of 58, so the first 24
    // characters come up ~17% more often. That makes ids more guessable than their
    // length suggests — and the id is what keeps an unlisted paste unlisted.
    //
    // 58 buckets over 120 000 draws: ~2069 expected each. A modulo bias would put the
    // first 24 at ~2400 and the rest at ~1800, so a ±25% band separates the two
    // implementations while staying far outside normal sampling noise.
    const counts = new Map<string, number>();
    for (let i = 0; i < 15_000; i += 1) {
      for (const char of newPasteId()) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    expect(counts.size).toBe(58);
    const expected = (15_000 * ID_LENGTH) / 58;
    for (const [char, n] of counts) {
      expect(
        n,
        `'${char}' appeared ${n} times, expected ~${Math.round(expected)}`,
      ).toBeGreaterThan(expected * 0.75);
      expect(
        n,
        `'${char}' appeared ${n} times, expected ~${Math.round(expected)}`,
      ).toBeLessThan(expected * 1.25);
    }
  });

  it("rejects ids it did not issue", () => {
    expect(isPasteId("")).toBe(false);
    expect(isPasteId("short")).toBe(false);
    expect(isPasteId("toolongforus")).toBe(false);
    // Excluded characters, which also means a url-decoded id cannot smuggle one in.
    expect(isPasteId("0bcdefgh")).toBe(false);
    expect(isPasteId("Olcdefgh")).toBe(false);
    expect(isPasteId("abcdefg-")).toBe(false);
  });
});

describe("withFreshId", () => {
  it("retries past a collision rather than pre-checking", async () => {
    // Catches the race a `SELECT … WHERE id = ?` pre-check would introduce: two
    // concurrent creates both read "free", and the second insert fails anyway. The
    // unique index is the only thing that actually decides, so the code lets it decide.
    const seen: string[] = [];
    let attempts = 0;

    const result = await withFreshId(async (id) => {
      seen.push(id);
      attempts += 1;
      if (attempts === 1) {
        // Postgres' unique_violation, as the driver surfaces it.
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }
      return `saved:${id}`;
    });

    expect(attempts).toBe(2);
    expect(result).toBe(`saved:${seen[1]}`);
    // A fresh id per attempt. Retrying with the same one would loop until the limit and
    // then report a collision that was really the same collision three times.
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("gives up rather than looping, because three collisions mean a broken generator", async () => {
    let attempts = 0;
    await expect(
      withFreshId(async () => {
        attempts += 1;
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }),
    ).rejects.toThrow(/not chance/);

    // Bounded. At a ~1e-8 collision rate three consecutive failures are not bad luck —
    // they mean the generator or the index is wrong, and an unbounded retry would hide
    // that permanently behind a slow create.
    expect(attempts).toBe(MAX_ID_ATTEMPTS);
  });

  it("does not swallow an unrelated database error", async () => {
    // The dangerous version of this helper catches everything and retries. A NOT NULL
    // violation would then be retried three times and reported as an id collision,
    // pointing every future reader at the wrong subsystem.
    const notOurs = Object.assign(new Error("null value in column"), {
      code: "23502",
    });

    let attempts = 0;
    await expect(
      withFreshId(async () => {
        attempts += 1;
        throw notOurs;
      }),
    ).rejects.toBe(notOurs);

    expect(attempts).toBe(1);
  });

  it("passes the id it generated to the attempt", async () => {
    const spy = vi.fn(async (id: string) => id);
    const id = await withFreshId(spy);
    expect(isPasteId(id)).toBe(true);
    expect(spy).toHaveBeenCalledWith(id);
  });
});
