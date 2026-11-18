// @vitest-environment node

// The test that decides whether the product is dangerous (ARCHITECTURE N1, §6.1).
//
// The claim is absolute: when a tier-1 credential is pasted, NOTHING is written, so no
// URL for that text has ever existed. Not "the paste is deleted afterwards" and not "the
// paste is marked blocked" — both of those make the credential addressable for a window,
// and a crash inside the window makes it addressable forever.
//
// A row count is the only honest assertion for that. It is also why these tests run
// against a real database: a mocked Prisma would record that no `create` was called,
// which is a statement about this implementation rather than about the invariant.

import { describe, expect, it } from "vitest";

import { BlockedBySecretScan, NeedsOverride } from "@/lib/server/create-paste";
import {
  ownedCounts,
  skipReason,
  slackTokenShape,
  withTestOwner,
} from "@/lib/server/create-test-harness";
import { createPaste } from "@/lib/server/mutations";
import { prisma } from "@/lib/server/prisma";

const reason = skipReason();

describe.skipIf(reason !== null)(
  `tier-1 refusal${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    it("writes no paste, revision, render or finding", async () => {
      await withTestOwner(async (owner) => {
        const body = `SLACK_TOKEN = "${slackTokenShape()}"\n`;

        await expect(
          createPaste(owner.viewer, { body, retention: "1h" }),
        ).rejects.toThrow(BlockedBySecretScan);

        const counts = await ownedCounts(owner.userId);
        expect(counts.pastes).toBe(0);
        expect(counts.revisions).toBe(0);
        expect(counts.renders).toBe(0);
        // No finding row either. A `secret_findings` row needs a `paste_id`, which is
        // why `outcome` deliberately has no 'blocked' value — the earlier draft of the
        // schema enumerated one that could never exist.
        expect(counts.findings).toBe(0);
      });
    });

    it("records exactly one audit row, naming the rule and not the secret", async () => {
      await withTestOwner(async (owner) => {
        const token = slackTokenShape();

        await expect(
          createPaste(owner.viewer, {
            body: `SLACK_TOKEN = "${token}"\n`,
            retention: "1h",
          }),
        ).rejects.toThrow(BlockedBySecretScan);

        const rows = await prisma.auditLog.findMany({
          where: { actorId: owner.userId },
        });
        // One row, not zero: "nothing is written" means no addressable content, not no
        // record. Security needs to know a live key was pasted, and the earlier draft
        // over-applied the slogan until the deferred webhook had nothing to read.
        expect(rows).toHaveLength(1);
        expect(rows[0].action).toBe("paste.blocked");
        // The subject is the body hash, because there is no paste id to cite — which is
        // precisely the property being recorded.
        expect(rows[0].subjectType).toBe("attempt");
        expect(rows[0].subjectId).toMatch(/^[0-9a-f]{64}$/);

        // The payload must carry the rule and never the match. A table of extracted
        // credentials is a better target than the pastes they came from (§6.1).
        const payload = JSON.stringify(rows[0].payload);
        expect(payload).toContain("slack");
        expect(payload).not.toContain(token);
        // Not even a long fragment of it. The preview is first-four + last-four only.
        expect(payload).not.toContain(token.slice(0, 20));
      });
    });

    it("stays at one audit row when the same body is retried", async () => {
      await withTestOwner(async (owner) => {
        const body = `SLACK_TOKEN = "${slackTokenShape()}"\n`;

        for (let i = 0; i < 3; i += 1) {
          await expect(
            createPaste(owner.viewer, { body, retention: "1h" }),
          ).rejects.toThrow(BlockedBySecretScan);
        }

        // The dedupe unique on (subject_type, subject_id, action, dedupe_key) is what
        // makes a retried request idempotent. Without it, a client retrying on a 422 —
        // or a user pressing Save twice — inflates the security signal into noise, which
        // is how a real block gets lost among duplicates.
        const counts = await ownedCounts(owner.userId);
        expect(counts.audit).toBe(1);
        expect(counts.pastes).toBe(0);
      });
    });

    it("records a block for every person who pastes the same credential", async () => {
      const body = `SLACK_TOKEN = "${slackTokenShape()}"\n`;

      // The bug this catches, found by this test file failing: the dedupe unique is
      // (subject_type, subject_id, action, dedupe_key) and has no actor column, so a
      // `dedupe_key` of just the body hash made the FIRST person to paste a credential
      // the only one ever recorded. Everyone after them was swallowed as a duplicate.
      //
      // That is the inverse of the row's purpose. A leaked key pasted by five people is
      // five facts security needs, and the symptom — a block that works but is not
      // logged — is invisible from the outside.
      for (const _ of [1, 2]) {
        await withTestOwner(async (owner) => {
          await expect(
            createPaste(owner.viewer, { body, retention: "1h" }),
          ).rejects.toThrow(BlockedBySecretScan);

          expect((await ownedCounts(owner.userId)).audit).toBe(1);
        });
      }
    });

    it("refuses before the scanner can be used as an oracle", async () => {
      await withTestOwner(async (owner) => {
        // A tier-1 finding is not overridable, and there must be no argument that makes
        // it so. Passing a justification is the obvious thing an API client would try.
        await expect(
          createPaste(owner.viewer, {
            body: `SLACK_TOKEN = "${slackTokenShape()}"\n`,
            retention: "1h",
            override: { justification: "it is a test token, honestly" },
          }),
        ).rejects.toThrow(BlockedBySecretScan);

        expect((await ownedCounts(owner.userId)).pastes).toBe(0);
      });
    });
  },
);

describe.skipIf(reason !== null)(
  `tier-2 override${reason ? ` (skipped: ${reason})` : ""}`,
  () => {
    /** A tier-2 shape: an assignment to a secret-shaped name with a non-placeholder
     *  value. Overridable, unlike tier 1 — which is the distinction under test. */
    const TIER_2 = `api_key = "${"h7Kq".repeat(8)}"\n`;

    it("writes nothing while the creator has not answered", async () => {
      await withTestOwner(async (owner) => {
        await expect(
          createPaste(owner.viewer, { body: TIER_2, retention: "1h" }),
        ).rejects.toThrow(NeedsOverride);

        // Distinct from a tier-1 block: this is a question, not a refusal. But it still
        // must not write, or answering "redact it instead" would leave the first version
        // stored — the exact outcome §6.1 exists to prevent.
        const counts = await ownedCounts(owner.userId);
        expect(counts.pastes).toBe(0);
        expect(counts.audit).toBe(0);
      });
    });

    it("stores a render whose markup carries no inline styles", async () => {
      await withTestOwner(async (owner) => {
        const paste = await createPaste(owner.viewer, {
          body: "def greet(name):\n    return f'hi {name}'\n",
          language: "python",
          retention: "1h",
        });

        const render = await prisma.render.findFirst({
          where: { revision: { pasteId: paste.id } },
        });

        // Stage 8 ran and committed. This assertion was impossible until the node
        // environment landed: under jsdom Shiki's oniguruma WASM cannot load, the render
        // failed, the create path swallowed it by design, and every `renders` count in
        // this file read zero for the wrong reason.
        expect(render).not.toBeNull();
        expect(render!.theme).toBe("paste");
        expect(render!.html).toContain("class=");

        // The CSP property §6.5 rests on, now asserted for the save-time renderer and
        // not only for the pre-rendered fixtures. A second renderer emitting inline
        // styles would quietly require `style-src 'unsafe-inline'` on the one page that
        // renders hostile text.
        expect(render!.html).not.toContain('style="');
        // And the shared class vocabulary, so the committed stylesheet actually matches.
        expect(render!.html).toMatch(/\btk-[a-z-]+\b/);
      });
    });

    it("saves with the justification recorded per finding once answered", async () => {
      await withTestOwner(async (owner) => {
        const paste = await createPaste(owner.viewer, {
          body: TIER_2,
          retention: "1h",
          override: { justification: "rotated key in a public sample" },
        });

        expect(paste.id).toHaveLength(8);

        const findings = await prisma.secretFinding.findMany({
          where: { pasteId: paste.id },
        });
        expect(findings.length).toBeGreaterThan(0);
        for (const finding of findings) {
          // "They clicked through" is not an audit trail. The justification is stored
          // against each finding, with who acknowledged it.
          expect(finding.outcome).toBe("overridden");
          expect(finding.overrideJustification).toBe(
            "rotated key in a public sample",
          );
          expect(finding.acknowledgedById).toBe(owner.userId);
          // The preview, never the match.
          expect(finding.matchPreview).toContain("…");
        }
      });
    });
  },
);
