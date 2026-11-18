// The retention option set from ARCHITECTURE §6.3.
//
// 30 days is the default and the most consequential single value in the product:
// retention is the deletion mechanism, so this number decides how long an undetected
// secret is exposed and whether a link in a ticket outlives the ticket.

import type { RetentionCode } from "@/lib/types";

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** The gap between a paste expiring and its bytes being destroyed. A grace window for
 *  one real case: an incident review cites a paste that lapsed last week. */
export const PURGE_GAP_MS = 30 * DAY;

export const DEFAULT_RETENTION: RetentionCode = "30d";

interface RetentionOption {
  label: string;
  /** null means it never expires — the only option with unbounded cost. */
  ms: number | null;
  /** "never" additionally requires a typed reason, which is what keeps it rare. */
  needsReason: boolean;
}

export const RETENTION: Record<RetentionCode, RetentionOption> = {
  "1h": { label: "1 hour", ms: HOUR, needsReason: false },
  "1d": { label: "1 day", ms: DAY, needsReason: false },
  "30d": { label: "30 days", ms: 30 * DAY, needsReason: false },
  "1y": { label: "1 year", ms: 365 * DAY, needsReason: false },
  never: { label: "Never", ms: null, needsReason: true },
};

/** A const tuple, not Object.keys: z.enum needs literals to produce a literal union,
 *  and casting to string[] silently widens `retention` to `string` everywhere
 *  downstream. `satisfies` keeps this in step with the RetentionCode type. */
export const RETENTION_CODES = [
  "1h",
  "1d",
  "30d",
  "1y",
  "never",
] as const satisfies readonly RetentionCode[];

/** When a paste created at `createdAt` stops answering, or null for "never". */
export function expiresAt(
  createdAt: string | number,
  code: RetentionCode,
): string | null {
  const ms = RETENTION[code].ms;
  if (ms === null) return null;
  const created =
    typeof createdAt === "number" ? createdAt : Date.parse(createdAt);
  return new Date(created + ms).toISOString();
}

/** When its bytes are destroyed, or null for "never". */
export function purgeAfter(
  createdAt: string | number,
  code: RetentionCode,
): string | null {
  const expires = expiresAt(createdAt, code);
  if (expires === null) return null;
  return new Date(Date.parse(expires) + PURGE_GAP_MS).toISOString();
}
