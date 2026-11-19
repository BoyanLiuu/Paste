// Forking a paste (ARCHITECTURE §6.3).
//
// A FORK IS A CREATE. That one sentence decides everything here: it gets a new id, a new
// retention, a new owner, and — the part that matters — THE FULL SCANNER RUNS AGAIN.
//
// Why re-scan a body that was already accepted once: the rule set changes. A paste made
// last month passed the scanner as it was then, and a rule added since may now match it.
// Copying the bytes without re-scanning would make forking a laundering path — the one way
// to get a now-known credential into a fresh, unblocked paste — and it would be the
// obvious route precisely because the original is already sitting there as proof the
// content was once allowed.
//
// It also means a fork can be REFUSED while its source still reads fine. That looks
// inconsistent and is correct: the source is grandfathered because destroying it is a
// separate decision with its own queue (§6.3), while a new paste has no such claim.

import "server-only";

import { record } from "@/lib/audit";
import { prisma } from "@/lib/server/prisma";
import { createPasteInDatabase } from "@/lib/server/create-paste";
import type { Paste, RetentionCode } from "@/lib/types";

export class NothingToFork extends Error {
  constructor(readonly pasteId: string) {
    super(`paste ${pasteId} has no body to fork`);
    this.name = "NothingToFork";
  }
}

export interface ForkArgs {
  sourceId: string;
  ownerId: string;
  retention: RetentionCode;
  neverReason?: string;
}

/**
 * Fork a paste, re-scanning its body.
 *
 * Delegates to the create path rather than copying rows, which is what keeps "a fork is a
 * create" true in code and not just in the document. Every stage applies: normalise, the
 * detection ladder, the scanner, the single write transaction, the render outside it. A
 * tier-1 hit therefore throws `BlockedBySecretScan` exactly as a fresh paste would, and
 * nothing is written.
 */
export async function forkPasteInDatabase(args: ForkArgs): Promise<Paste> {
  const source = await prisma.paste.findUnique({
    where: { id: args.sourceId },
    select: {
      id: true,
      title: true,
      language: true,
      lineNumbers: true,
      revisions: {
        orderBy: { revisionNo: "desc" },
        take: 1,
        select: { bodyText: true, storageKey: true },
      },
    },
  });

  if (source === null) throw new NothingToFork(args.sourceId);

  const head = source.revisions[0];
  if (head === undefined) throw new NothingToFork(args.sourceId);

  // A purged or redacted-away body cannot be forked, and the error says so rather than
  // producing an empty paste. Both pointers null means the bytes are gone — there is
  // nothing to copy, and inventing an empty fork would attach this paste's provenance to
  // content it never had.
  if (head.bodyText === null && head.storageKey === null) {
    throw new NothingToFork(args.sourceId);
  }

  const body =
    head.bodyText ??
    (await (async () => {
      const { getBody } = await import("@/lib/storage/body");
      return getBody(head.storageKey!);
    })());

  const forked = await createPasteInDatabase({
    ownerId: args.ownerId,
    body,
    // The title is carried over with a marker, because a list of five identical titles is
    // unreadable and the provenance panel is on the view page, not the list.
    title: source.title === null ? undefined : `${source.title} (fork)`,
    // The language is carried, not re-detected: the source's `language_source` may have
    // been an explicit human choice, and the ladder would overwrite it with a guess.
    language: source.language,
    lineNumbers: source.lineNumbers,
    retention: args.retention,
    neverReason: args.neverReason,
    createdVia: "web",
    forkedFrom: source.id,
  });

  await record({
    action: "paste.forked",
    subjectType: "paste",
    subjectId: forked.id,
    actorId: args.ownerId,
    payload: { from: source.id, retention: args.retention },
  });

  return forked;
}
