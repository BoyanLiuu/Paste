// The moderation queue (ARCHITECTURE §3, ux-37 – 41).
//
// One read, shaped for one decision. A moderator looking at a removal request needs the
// justification, who asked, and HOW MANY PEOPLE HAVE READ IT — §6.3 names the 90-day view
// count as the decision input, because it is the only thing on the screen that says
// whether destroying this paste breaks something.
//
// Covered by `deletion_requests_open`, the partial index M6 created for exactly this
// query. That index is why the queue stays cheap with 40 000 closed requests behind it
// (N8) — a full index on `status` would make the sweep read rows it will skip.

import "server-only";

import { trailFor } from "@/lib/audit";
import { prisma } from "@/lib/server/prisma";
import type { AuditEntry, RemovalRequest } from "@/lib/types";

/** How far back the view count looks. Named because §6.3 names it. */
export const VIEW_WINDOW_DAYS = 90;

/**
 * Open requests, oldest first.
 *
 * Oldest first and not newest: a queue worked newest-first starves its oldest entries,
 * and the oldest open request is by definition the one that has been waiting longest for
 * someone to decide whether a secret stays published.
 */
export async function openRequests(): Promise<RemovalRequest[]> {
  const since = new Date(Date.now() - VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.deletionRequest.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "asc" },
    include: {
      requester: { select: { username: true } },
      decidedBy: { select: { username: true } },
      paste: {
        select: {
          id: true,
          // The daily series, summed below. A running `view_count` on the paste would be
          // cheaper and would answer the wrong question — "ever" rather than "recently" —
          // and a paste read heavily two years ago is not a paste anyone would miss.
          views: {
            where: { day: { gte: since } },
            select: { n: true },
          },
        },
      },
    },
  });

  return Promise.all(rows.map(toRemovalRequest));
}

/** One request, for the decision screen. */
export async function requestById(
  id: number,
): Promise<RemovalRequest | null> {
  const since = new Date(Date.now() - VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const row = await prisma.deletionRequest.findUnique({
    where: { id },
    include: {
      requester: { select: { username: true } },
      decidedBy: { select: { username: true } },
      paste: {
        select: {
          id: true,
          views: { where: { day: { gte: since } }, select: { n: true } },
        },
      },
    },
  });

  return row === null ? null : toRemovalRequest(row);
}

interface Row {
  id: number;
  pasteId: string;
  relationship: string;
  reasonCode: string;
  justification: string;
  status: string;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  requester: { username: string };
  decidedBy: { username: string } | null;
  paste: { id: string; views: { n: number }[] } | null;
}

async function toRemovalRequest(row: Row): Promise<RemovalRequest> {
  return {
    id: row.id,
    pasteId: row.pasteId,
    requester: row.requester.username,
    relationship: row.relationship as RemovalRequest["relationship"],
    reason: row.reasonCode as RemovalRequest["reason"],
    justification: row.justification,
    status: row.status as RemovalRequest["status"],
    openedAt: row.createdAt.toISOString(),
    decidedBy: row.decidedBy?.username ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    note: row.decisionNote,
    views90: (row.paste?.views ?? []).reduce((sum, v) => sum + v.n, 0),
    audit: await auditFor(row.id, row.pasteId),
  };
}

/**
 * The trail a moderator reads, covering the request AND the paste it is about.
 *
 * Two subjects, because the interesting history is split across them: the paste's creation
 * and any earlier purge are recorded against the paste, while the request and its decision
 * are recorded against the request. Showing only one half makes a decision look like it
 * came out of nowhere.
 */
async function auditFor(
  requestId: number,
  pasteId: string,
): Promise<AuditEntry[]> {
  const [onRequest, onPaste] = await Promise.all([
    trailFor("request", String(requestId)),
    trailFor("paste", pasteId),
  ]);

  return [...onPaste, ...onRequest]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((entry) => ({
      at: entry.at.toISOString(),
      // Null actor means the system did it. The designed screen distinguishes a human act
      // from an instrument's, which is what `kind` is for.
      actor: entry.actor ?? "the sweeper",
      kind: entry.actor === null ? ("instrument" as const) : ("person" as const),
      action: entry.action,
      detail: detailOf(entry.action, entry.payload),
    }));
}

/** A human sentence from the stored payload, because a moderator reads this, not a log. */
function detailOf(action: string, payload: unknown): string {
  const data = (payload ?? {}) as Record<string, unknown>;

  switch (action) {
    case "paste.created":
      return `Created via ${String(data.via ?? "the web form")}, ${String(data.lineCount ?? "?")} lines.`;
    case "paste.forked":
      return `Forked from ${String(data.from ?? "another paste")}.`;
    case "paste.blocked":
      return `A tier-1 secret was refused: ${String(data.tier1Count ?? 0)} finding(s).`;
    case "paste.purged":
      return data.request === undefined
        ? "The bytes were destroyed."
        : `The bytes were destroyed on request ${String(data.request)}.`;
    case "paste.redacted":
      return `The secret was removed and a marker revision replaced it (request ${String(data.request ?? "?")}).`;
    case "removal.requested":
      return `Requested as ${String(data.claimedRelationship ?? "unknown")}, verified as ${String(data.verifiedAs ?? "unknown")}.`;
    case "removal.decided":
      return `${String(data.decision ?? "decided")}: ${String(data.note ?? "")}`;
    default:
      return "";
  }
}
