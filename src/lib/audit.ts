// The append-only record of every consequential act (ARCHITECTURE §2, §6.3).
//
// ONE PATH. Before this module there were two hand-rolled call sites — the create path's
// block record and the sweeper's purge record — each with its own copy of the
// unique-violation handling, and the second one got the dedupe key wrong in a way that
// made every person after the first invisible. A third copy was about to be written for
// moderation, which is what this exists to prevent.
//
// APPEND-ONLY, and that is the point rather than a convenience. A redaction that could be
// un-recorded is worse than no redaction, because it makes every other paste's content
// unverifiable too (§6.3). Nothing here updates or deletes; the only write is an insert.

import "server-only";

import { prisma } from "@/lib/server/prisma";

/**
 * What happened. One string per kind of act, because this is read by a human months later
 * and `"paste.redacted"` tells them more than a numeric code ever will.
 */
export type AuditAction =
  | "paste.created"
  | "paste.blocked"
  | "paste.forked"
  /** A guest signed in and moved their pastes into the account (M16). The actor is the
   *  account; the payload carries the guest handle that is about to stop existing, which
   *  is the only place that correspondence is ever written down. */
  | "paste.claimed"
  | "paste.purged"
  | "paste.redacted"
  | "removal.requested"
  | "removal.decided";

export interface AuditEntry {
  action: AuditAction;
  /** What the act was about: a paste id, a request id, or a body hash for a blocked
   *  attempt that never became a paste. */
  subjectType: "paste" | "request" | "attempt";
  subjectId: string;
  /** Who did it. Null for the sweeper, which is nobody — and correctly so: attributing a
   *  scheduled purge to a person would be a lie in the one record meant to be trusted. */
  actorId?: string | null;
  /**
   * Makes a retry idempotent.
   *
   * The unique index is `(subject_type, subject_id, action, dedupe_key)` and carries NO
   * actor column, so a key that omits the actor collapses distinct people into one row.
   * That shipped once: a bare body hash on `paste.blocked` meant the first person to paste
   * a given credential was the only one ever recorded. Include the actor whenever the same
   * subject can be acted on by more than one person.
   */
  dedupeKey?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Record an act. Returns true if this call wrote the row, false if it was already there.
 *
 * NEVER THROWS ON A DUPLICATE, and never lets a logging failure fail the act it describes.
 * A killed purge job is re-claimed and re-runs every step, so a duplicate insert is an
 * expected outcome rather than an error — and for a blocked paste, the refusal is the
 * security-relevant event and it holds whether or not the record landed.
 *
 * It DOES let a non-duplicate failure propagate for moderator actions, via `required`.
 * A redaction whose audit row silently failed to write is exactly the silent redaction
 * §6.3 forbids, so those callers would rather fail the whole operation.
 */
export async function record(
  entry: AuditEntry,
  options: { required?: boolean } = {},
): Promise<boolean> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        actorId: entry.actorId ?? null,
        dedupeKey: entry.dedupeKey ?? null,
        payload: (entry.payload ?? {}) as never,
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;

    if (options.required === true) throw error;

    // Logged, not swallowed silently. The act already happened; losing its record is bad
    // and failing the act over it would be worse.
    console.error(
      `audit: could not record ${entry.action} on ${entry.subjectType} ${entry.subjectId}`,
      error,
    );
    return false;
  }
}

/**
 * Record inside an open transaction.
 *
 * Moderator decisions need this: the row and the decision have to land together, or a
 * rolled-back redaction leaves an audit entry claiming it happened. The duplicate
 * tolerance above is deliberately absent here — a duplicate inside a transaction means
 * the caller is doing something it has not thought about, and swallowing it would abort
 * the surrounding transaction anyway.
 */
export async function recordIn(
  tx: Pick<typeof prisma, "auditLog">,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId,
      actorId: entry.actorId ?? null,
      dedupeKey: entry.dedupeKey ?? null,
      payload: (entry.payload ?? {}) as never,
    },
  });
}

/** The trail for one subject, oldest first, as the view page and a ticket would read it. */
export async function trailFor(
  subjectType: AuditEntry["subjectType"],
  subjectId: string,
): Promise<
  {
    at: Date;
    action: string;
    actor: string | null;
    payload: unknown;
  }[]
> {
  const rows = await prisma.auditLog.findMany({
    where: { subjectType, subjectId },
    orderBy: { at: "asc" },
    include: { actor: { select: { username: true } } },
  });

  return rows.map((row) => ({
    at: row.at,
    action: row.action,
    // Null means the system did it. `trailFor` does not substitute a friendly name,
    // because "Paste" or "system" reads as a user account and this record is evidence.
    actor: row.actor?.username ?? null,
    payload: row.payload,
  }));
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "23505" || code === "P2002";
}
