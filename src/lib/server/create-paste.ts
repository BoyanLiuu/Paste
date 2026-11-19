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

import { BlockedBySecretScan, NeedsOverride } from "@/lib/server/create-errors";

import { randomUUID } from "node:crypto";

import { record, recordIn } from "@/lib/audit";
import { resolveLanguage } from "@/lib/detect/ladder";
import { expiresAt, purgeAfter } from "@/lib/expiry/retention";
import { withFreshId } from "@/lib/ids";
import { normalise } from "@/lib/normalise";
import { highlight, THEME_NAME } from "@/lib/render/highlight";
import {
  renderMode,
  renderWorthStoring,
  storageFor,
} from "@/lib/render/thresholds";
import { PASTE_INCLUDE, toPaste } from "@/lib/server/map";
import { prisma } from "@/lib/server/prisma";
import { scan, worstTier } from "@/lib/secrets/scan";
import {
  putBody,
  storageConfigured,
  StorageNotConfigured,
} from "@/lib/storage/body";
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
  createdVia: "web" | "api";
  /** sha256(ip + daily salt), never the address itself (§6.1). */
  createdIpHash?: string;
  /** The paste this was forked from, for the view page's provenance panel. A fork runs the
   *  full create path including the scanner, so this is the only field that marks it as
   *  one (§6.3). */
  forkedFrom?: string;
  /**
   * Tier-2/3 findings the creator chose to save past, with their justification.
   *
   * A tier-1 finding is NOT overridable and there is no argument for it here. The
   * refusal is the product's position, not a default someone can pass a flag to change.
   */
  override?: { justification: string };
}

// `BlockedBySecretScan` and `NeedsOverride` moved to `create-errors.ts`, re-exported here
// so every existing call site keeps working.
//
// They left because catching them needs `instanceof` — a real import, not a type-only one —
// and this module pulls in the highlighter for stage 8. The fork action caught both and so
// put Shiki in the view page's graph, breaking N2's stated zero. An error class should be
// the cheapest thing to import from a module, not the most expensive.
export { BlockedBySecretScan, NeedsOverride } from "@/lib/server/create-errors";

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
  //
  // The object, if there is one, is written BEFORE the transaction opens.
  //
  // Two orderings are possible and only one is safe. Insert the row first and upload
  // after, and a failed upload leaves a revision pointing at an object that does not
  // exist — which every read path answers as a missing body, i.e. indistinguishable from
  // a purge. Upload first and fail to insert, and the object is orphaned with nothing
  // pointing at it: wasted bytes, caught by the weekly orphan report in §6.4, and no
  // reader ever sees a lie. The same reasoning as phase B's "delete the object before
  // nulling the key", pointing the other way.
  //
  // The revision id is generated here rather than by the database, because the object key
  // contains it and the upload has to happen first.
  const revisionId = randomUUID();
  let storageKey: string | null = null;

  if (storageFor(byteSize) === "object") {
    if (!storageConfigured()) {
      // Loud, not a silent fallback to inline. An over-threshold body in a `text` column
      // would work until it did not, and the failure would arrive as a Postgres row-size
      // error on someone else's paste.
      throw new StorageNotConfigured();
    }
    storageKey = await putBody(revisionId, body);
  }

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
          forkedFrom: args.forkedFrom ?? null,
          createdAt,
          updatedAt: createdAt,
        },
      });

      const revision = await tx.revision.create({
        data: {
          id: revisionId,
          pasteId: id,
          revisionNo: 1,
          byteSize,
          lineCount,
          sha256,
          // Exactly one pointer, decided here and never changed. The M6 trigger permits
          // only the purge as a body mutation, so a revision cannot later be migrated
          // between inline text and an object — which is why the threshold is applied
          // once, at insert, from the byte count.
          bodyText: storageKey === null ? body : null,
          storageKey,
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

      await recordIn(tx, {
        action: "paste.created",
        subjectType: "paste",
        subjectId: id,
        actorId: args.ownerId,
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

    // THE OUTPUT CAP, measured at M12. A line count cannot bound markup — the same
    // 2 000-line TypeScript body produces 348 KB or 1.2 MB depending on how dense its
    // lines are — so the quantity §6.2 cares about is checked on itself, once it exists.
    // Discarding the render here costs one wasted highlight on a save that still
    // succeeded, and the reader gets the escaped-text path with its banner.
    if (!renderWorthStoring(html)) {
      console.info(
        `render for paste ${pasteId} exceeded the markup budget; serving plain text`,
      );
      return;
    }

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

  await record({
    action: "paste.blocked",
    subjectType: "attempt",
    // The body hash, because there is no paste id to cite — which is precisely the
    // property being recorded.
    subjectId: sha256,
    actorId: ownerId,
    // ACTOR + HASH. A bare hash made the first person to paste a given credential the
    // only one ever recorded, because the unique index carries no actor column. A leaked
    // key pasted by five people is five facts security needs.
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
  });
}

const asDate = (value: string | null): Date | null =>
  value === null ? null : new Date(value);
