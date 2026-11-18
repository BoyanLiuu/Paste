// "In 21 hours", "In 40 minutes", "Expired 31 Oct".
//
// The expiry column is the point of a list row: someone scanning their pastes is
// deciding what is about to disappear. An absolute date answers that badly when the
// answer is "within the hour", and a relative phrase answers it badly when the answer
// is "next March". So: relative while it is urgent, absolute once it is not.

import { formatDate } from "@/lib/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Below this, the relative phrase is more useful than the date. Two days, because
 *  "in 36 hours" still changes what someone does today and "in 9 days" does not. */
const RELATIVE_WINDOW = 2 * DAY;

export interface ExpiryPhrase {
  text: string;
  /** True while the phrase is relative, so the row can mark it as worth attention. */
  urgent: boolean;
}

export function expiryPhrase(
  expiresAt: string | null,
  now = Date.now(),
): ExpiryPhrase {
  if (expiresAt === null) return { text: "Never", urgent: false };

  const remaining = Date.parse(expiresAt) - now;

  if (remaining <= 0) {
    // Past tense and dated: a lapsed paste is a fact, not a countdown.
    return { text: `Expired ${formatDate(expiresAt)}`, urgent: false };
  }

  if (remaining >= RELATIVE_WINDOW) {
    return { text: formatDate(expiresAt), urgent: false };
  }

  if (remaining < HOUR) {
    const minutes = Math.max(1, Math.round(remaining / MINUTE));
    return { text: `In ${minutes} ${plural(minutes, "minute")}`, urgent: true };
  }

  const hours = Math.round(remaining / HOUR);
  return { text: `In ${hours} ${plural(hours, "hour")}`, urgent: true };
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
