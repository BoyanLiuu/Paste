// Stages 5–8 of the create path (ARCHITECTURE §4). The ordering IS the implementation.
//
// Three positions carry the design, and each one is a decision someone could undo while
// believing they were tidying up:
//
//   5-6. The scan runs BEFORE the insert. A tier-1 hit returns here with nothing written,
//        so no URL for that text has ever existed. Scanning after the insert — the
//        natural shape, since you then have a paste to attach findings to — means a live
//        credential is addressable for however long the delete takes, and a crash in
//        between leaves it addressable forever.
//     7. The write is one transaction: paste, revision 1, the head pointer, any
//        overridden findings, the audit row. Half a create is worse than none.
//     8. The render runs OUTSIDE it, so a grammar bug cannot roll back a correctly saved
//        paste. The view page already handles a missing render by escaping the body, so
//        the cost of failing here is a plainer page, not a lost snippet.

import "server-only";

import { resolveLanguage } from "@/lib/detect/ladder";
import { expiresAt, purgeAfter } from "@/lib/expiry/retention";
import { withFreshId } from "@/lib/ids";
import { normalise } from "@/lib/normalise";
import { highlight, THEME_NAME } from "@/lib/render/highlight";
import { renderMode } from "@/lib/render/thresholds";
import { PASTE_INCLUDE, toPaste } from "@/lib/server/map";
import { prisma } from "@/lib/server/prisma";
import { scan, worstTier } from "@/lib/secrets/scan";
import type { Finding, Paste, RetentionCode } from "@/lib/types";

export interface CreateArgs {
  ownerId: string;
  body: string;
  title?: string;
  language?: string;
  filename?: string;
  lineNumbers: boolean;
  retention: RetentionCode;
  neverReason?: string;
  createdVia: "web" | "cli" | "api";
  /** sha256(ip + daily salt), never the address itself (§6.1). */
  createdIpHash?: string;
  /**
   * Tier-2/3 findings the creator chose to save past, with their justification.
   *
   * A tier-1 finding is NOT overridable and there is no argument for it here. The
   * refusal is the product's position, not a default someone can pass a flag to change.
   */
  override?: { justification: string };
}

/** A tier-1 refusal. Carries the findings so the form can offer redaction (§6.1). */
export class BlockedBySecretScan extends Error {
  constructor(
    readonly findings: Finding[],
    readonly scanState: "complete" | "partial",
  ) {
    super(
      `blocked: ${findings.filter((f) => f.tier === 1).length} tier-1 finding(s)`,
    );
    this.name = "BlockedBySecretScan";
  }
}

/** A tier-2/3 finding with no justification. Overridable, unlike tier 1. */
export class NeedsOverride extends Error {
  constructor(
    readonly findings: Finding[],
    readonly scanState: "complete" | "partial",
  ) {
    super(`needs override: ${findings.length} finding(s)`);
    this.name = "NeedsOverride";
  }
}

export async function createPasteInDatabase(args: CreateArgs): Promise<Paste> {
  // --- stage 4: normalise, so everything below measures the bytes that get stored
  const { body, byteSize, lineCount, sha256 } = normalise(args.body);

  // --- stage 5: resolve the language
  const detection = resolveLanguage({
    body,
    language: args.language,
    filename: args.filename,
  });

  // --- stage 6: scan, synchronously, before anything is written
  const result = scan(body);
  const tier = worstTier(result.findings);

  if (tier === 1) {
    // One audit row and no paste row. N1 is "no addressable content", not "no record":
    // security needs to know a live key was pasted, and the deferred webhook has nothing
    // to read otherwise. Written outside any transaction the caller might roll back.
    await recordBlock(args.ownerId, result.findings, sha256);
    throw new BlockedBySecretScan(result.findings, result.state);
  }

  if (tier !== null && args.override === undefined) {
    // Nothing written: the creator has not answered yet, and this is not a refusal.
    throw new NeedsOverride(result.findings, result.state);
  }

  // --- stage 7: one transaction
  const created = await withFreshId(async (id) => {
    const createdAt = new Date();

    return prisma.$transaction(async (tx) => {
      await tx.paste.create({
        data: {
          id,
          ownerId: args.ownerId,
          title: args.title ?? null,
          language: detection.language,
          languageSource: detection.source,
          lineNumbers: args.lineNumbers,
          retentionCode: args.retention,
          neverReason: args.neverReason ?? null,
          expiresAt: asDate(expiresAt(createdAt.getTime(), args.retention)),
          purgeAfter: asDate(purgeAfter(createdAt.getTime(), args.retention)),
          state: "live",
          createdVia: args.createdVia,
          createdIpHash: args.createdIpHash ?? null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      const revision = await tx.revision.create({
        data: {
          pasteId: id,
          revisionNo: 1,
          byteSize,
          lineCount,
          sha256,
          // M9 moves bodies over 512 KB to object storage. Until then the CHECK requires
          // exactly one pointer, so an over-threshold body is stored inline rather than
          // written with a storage_key pointing at nothing.
          bodyText: body,
          reason: "original",
          scanState: result.state,
          createdById: args.ownerId,
          createdAt,
        },
      });

      // Denormalised head pointer, set in the same transaction as the revision it names
      // — which is why it is not a foreign key.
      await tx.paste.update({
        where: { id },
        data: { headRevisionId: revision.id },
      });

      if (args.override !== undefined) {
        // Only the tier-2/3 findings the creator saved past. Recorded per finding, with
        // the justification, because "they clicked through" is not an audit trail.
        await tx.secretFinding.createMany({
          data: result.findings.map((finding) => ({
            pasteId: id,
            revisionId: revision.id,
            ruleId: finding.rule,
            tier: finding.tier,
            lineNo: finding.line,
            colStart: finding.colStart,
            colEnd: finding.colEnd,
            matchPreview: finding.preview,
            outcome: "overridden",
            overrideJustification: args.override!.justification,
            acknowledgedById: args.ownerId,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: args.ownerId,
          action: "paste.created",
          subjectType: "paste",
          subjectId: id,
          payload: {
            via: args.createdVia,
            language: detection.language,
            languageSource: detection.source,
            byteSize,
            lineCount,
            retention: args.retention,
            findings: result.findings.length,
            scanState: result.state,
          },
        },
      });

      return tx.paste.findUniqueOrThrow({
        where: { id },
        include: PASTE_INCLUDE,
      });
    });
  });

  // --- stage 8: render, outside the transaction
  await renderIfWorthwhile(
    created.id,
    created.revisions,
    body,
    detection.language,
  );

  return toPaste(created);
}

/**
 * Highlight and store, or do nothing.
 *
 * Deliberately swallows its own failures. The paste is already committed, and §6.2's
 * fallback — the view page escaping the body into a `<pre>` — is a real rendering path
 * rather than an error state, so a grammar that throws costs colour and nothing else.
 * Letting it propagate would turn a cosmetic problem into a 500 on a successful create.
 */
async function renderIfWorthwhile(
  pasteId: string,
  revisions: { id: string; byteSize: number; lineCount: number }[],
  body: string,
  language: string,
): Promise<void> {
  const head = revisions.at(-1);
  if (head === undefined) return;

  // Over the threshold there is no render by design (§6.2): the cost is linear in size
  // and the benefit vanishes on a 200 000-line log nobody reads in full.
  if (renderMode(head.byteSize, head.lineCount) !== "highlight") return;

  try {
    const html = await highlight(body, language);
    if (html === null) return;

    await prisma.render.create({
      data: { revisionId: head.id, theme: THEME_NAME, html },
    });
  } catch (error) {
    console.error(
      `render failed for paste ${pasteId}; serving plain text`,
      error,
    );
  }
}

/**
 * The audit row for a blocked attempt.
 *
 * `subject_id` is the body hash: there is no paste id to cite, which is exactly the
 * property being recorded.
 *
 * `dedupe_key` is **actor + hash, not the hash alone**. The unique index is
 * `(subject_type, subject_id, action, dedupe_key)` and carries no actor column, so a bare
 * hash means the first person to paste a given credential is the only one ever recorded —
 * every later user's block is silently swallowed as a duplicate. That is the opposite of
 * what the row is for: the point is to know who pasted a live key, and a leaked
 * credential being pasted by five people is five facts security needs.
 *
 * Dedupe is meant to make a RETRY idempotent — the same person, the same body, a
 * double-clicked Save or a client retrying on the 422 — not to collapse distinct people.
 */
async function recordBlock(
  ownerId: string,
  findings: Finding[],
  sha256: string,
): Promise<void> {
  const tier1 = findings.filter((f) => f.tier === 1);

  try {
    await prisma.auditLog.create({
      data: {
        actorId: ownerId,
        action: "paste.blocked",
        subjectType: "attempt",
        subjectId: sha256,
        dedupeKey: `${ownerId}:${sha256}`,
        payload: {
          // Rule ids and previews only. NEVER the matched text: a table of extracted
          // credentials is a better target than the pastes they came from (§6.1).
          rules: tier1.map((f) => ({
            rule: f.rule,
            line: f.line,
            preview: f.preview,
          })),
          tier1Count: tier1.length,
          totalFindings: findings.length,
        },
      },
    });
  } catch (error) {
    // The unique index on (subject_type, subject_id, action, dedupe_key) makes a repeat
    // attempt a no-op rather than a second row. Any other failure must not convert a
    // refusal into a 500 — the refusal is the security-relevant outcome and it still
    // holds whether or not the record landed.
    if (!isUniqueViolation(error)) {
      console.error("could not record a blocked attempt", error);
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "23505" || code === "P2002";
}

const asDate = (value: string | null): Date | null =>
  value === null ? null : new Date(value);
