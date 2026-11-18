// Paste identifiers (ARCHITECTURE §1.3).
//
// 8 characters of base58 from crypto.randomBytes. Not sequential, because the id IS the
// access control for an unlisted paste: a guessable id makes "unlisted" meaningless, and
// a sequential one makes enumerating every paste ever created a for-loop.

import { randomBytes } from "node:crypto";

/**
 * Bitcoin's base58 alphabet: no 0, O, I or l.
 *
 * The omissions are the point. These ids get read off screens, pasted into chat and
 * typed from memory, and `0`/`O` and `1`/`I`/`l` are the pairs people get wrong. A
 * transcription error should produce "no such paste" rather than someone else's.
 */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const ID_LENGTH = 8;

/**
 * The id space: 58^8 ≈ 1.28e14.
 *
 * At a million pastes the chance any single random id collides is ~8e-9, which is why
 * the insert-and-retry below effectively never retries — and why it must still exist.
 */
export const ID_SPACE = ALPHABET.length ** ID_LENGTH;

/**
 * One random id.
 *
 * Rejection sampling, not `byte % 58`. The modulo is the obvious version and it is
 * biased: 256 is not a multiple of 58, so the first 24 characters of the alphabet come
 * up ~17% more often than the rest. That shrinks the effective id space and makes the
 * ids more guessable than their length suggests — which matters here precisely because
 * the id is the access control.
 */
export function newPasteId(): string {
  const limit = 256 - (256 % ALPHABET.length); // 232
  let out = "";

  while (out.length < ID_LENGTH) {
    // Ask for what is still needed plus slack, so this is one syscall in practice
    // rather than one per character.
    const bytes = randomBytes((ID_LENGTH - out.length) * 2);
    for (const byte of bytes) {
      if (byte >= limit) continue; // Would bias the distribution; draw again.
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === ID_LENGTH) break;
    }
  }

  return out;
}

/** Whether a string could be an id this app issued, for route validation. */
export function isPasteId(value: string): boolean {
  if (value.length !== ID_LENGTH) return false;
  return [...value].every((char) => ALPHABET.includes(char));
}

/** Postgres' unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === UNIQUE_VIOLATION || code === "P2002";
}

export const MAX_ID_ATTEMPTS = 3;

/**
 * Run `attempt` with fresh ids until one does not collide.
 *
 * INSERT-AND-RETRY, NOT SELECT-THEN-INSERT. A pre-check that the id is free is a race:
 * two concurrent creates both read "free" and the second insert fails anyway, so the
 * check costs a round trip and buys nothing. The unique index is the only thing that
 * actually decides, so let it decide and handle the loss.
 *
 * Three attempts. Not because a fourth would be expensive, but because at a ~1e-8
 * collision rate three consecutive failures are not bad luck — they mean the id
 * generator is broken or the index means something other than what this assumes, and a
 * loop that keeps trying would hide that forever.
 */
export async function withFreshId<T>(
  attempt: (id: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < MAX_ID_ATTEMPTS; i += 1) {
    try {
      return await attempt(newPasteId());
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // Not ours to retry.
      lastError = error;
    }
  }

  throw new Error(
    `Could not find a free paste id in ${MAX_ID_ATTEMPTS} attempts. At this id length ` +
      `that is not chance — suspect the generator or the unique index.`,
    { cause: lastError },
  );
}
