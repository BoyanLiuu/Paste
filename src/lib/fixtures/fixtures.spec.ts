import { describe, expect, it } from "vitest";

import {
  DESIGNED_PASTES,
  PASTES,
  PASTES_BY_ID,
  REQUESTS,
} from "@/lib/fixtures";
import { RENDERS } from "@/lib/fixtures/renders.generated";
import { RETENTION_CODES } from "@/lib/expiry/retention";
import { renderMode } from "@/lib/render/thresholds";
import { renderKey, revisionKey } from "@/lib/render/keys";
import type { PasteState } from "@/lib/types";

// Catches a fixture set that cannot exercise the UI. Without these, a screen quietly
// has no data to show and the gap surfaces in phase 2, against real queries, when it is
// much more expensive to notice.

describe("fixture coverage", () => {
  it("covers every paste state", () => {
    const states: PasteState[] = ["live", "expired", "purged", "redacted"];
    const present = new Set(DESIGNED_PASTES.map((p) => p.state));
    expect([...present].toSorted()).toEqual(states.toSorted());
  });

  it("covers every retention code", () => {
    const present = new Set(DESIGNED_PASTES.map((p) => p.retention));
    expect([...present].toSorted()).toEqual([...RETENTION_CODES].toSorted());
  });

  it("covers all three rungs of the size ladder", () => {
    const modes = new Set(
      DESIGNED_PASTES.filter((p) => p.body !== null).map((p) =>
        renderMode(p.byteSize, p.lineCount),
      ),
    );
    expect(modes).toEqual(new Set(["highlight", "plain", "truncated"]));
  });

  it("includes a fork, a never-paste with its reason, and a moderator removal", () => {
    expect(DESIGNED_PASTES.some((p) => p.forkedFrom !== null)).toBe(true);
    expect(
      DESIGNED_PASTES.some(
        (p) => p.retention === "never" && p.neverReason !== null,
      ),
    ).toBe(true);
    expect(DESIGNED_PASTES.some((p) => p.removedBy !== null)).toBe(true);
  });
});

describe("fixture integrity", () => {
  // The render table is generated from these bodies. If a body changes and nobody runs
  // `pnpm fixtures:render`, the view page silently serves the old highlighting.
  it("has a generated render for every body under the highlight threshold", () => {
    const needRender = DESIGNED_PASTES.filter(
      (p) =>
        p.body !== null && renderMode(p.byteSize, p.lineCount) === "highlight",
    );
    expect(needRender.length).toBeGreaterThan(0);
    for (const paste of needRender) {
      expect(
        RENDERS[renderKey(revisionKey(paste.id, 1))],
        `${paste.id} has no generated render — run pnpm fixtures:render`,
      ).toBeTypeOf("string");
    }
  });

  it("has no render for a body above the threshold", () => {
    const tooBig = DESIGNED_PASTES.filter(
      (p) =>
        p.body !== null && renderMode(p.byteSize, p.lineCount) !== "highlight",
    );
    expect(tooBig.length).toBeGreaterThan(0);
    for (const paste of tooBig) {
      expect(RENDERS[renderKey(revisionKey(paste.id, 1))]).toBeUndefined();
    }
  });

  // A purged paste keeps its hash and loses its bytes. That residue is what lets a
  // tombstone prove what used to be there, so a purged fixture with no hash would make
  // the receipt screen unbuildable.
  it("keeps a hash on every purged revision and no body", () => {
    const purged = DESIGNED_PASTES.filter((p) => p.state === "purged");
    expect(purged.length).toBeGreaterThan(0);
    for (const paste of purged) {
      expect(
        paste.body,
        `${paste.id} is purged but still has bytes`,
      ).toBeNull();
      expect(paste.revisions[0].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(paste.revisions[0].purgedAt).not.toBeNull();
    }
  });

  it("truncates rather than lying about size", () => {
    for (const paste of PASTES) {
      if (paste.body === null) continue;
      // bodyShown describes the body we hold; lineCount describes the whole paste.
      expect(paste.bodyShown).toBeLessThanOrEqual(paste.lineCount);
      if (paste.bodyShown < paste.lineCount) {
        expect(renderMode(paste.byteSize, paste.lineCount)).not.toBe(
          "highlight",
        );
      }
    }
  });

  it("leaves the filler pastes unrendered, exercising the fallback", () => {
    // Filler exists for list volume, not for review, so rendering 110 extra bodies
    // would add hundreds of KB to a generated file nobody reads. Opening one takes
    // the view page's null-render path, which is a supported case rather than a gap.
    const filler = PASTES.filter((p) => p.id.startsWith("f"));
    expect(filler.length).toBeGreaterThan(50);
    for (const paste of filler.slice(0, 5)) {
      expect(RENDERS[renderKey(revisionKey(paste.id, 1))]).toBeUndefined();
    }
  });

  it("points every removal request at a paste that exists", () => {
    for (const request of REQUESTS) {
      expect(
        PASTES_BY_ID[request.pasteId],
        `request ${request.id} points at missing paste ${request.pasteId}`,
      ).toBeDefined();
    }
  });

  it("gives a redacted paste a purged revision 1 and a live revision 2", () => {
    const redacted = DESIGNED_PASTES.filter((p) => p.state === "redacted");
    expect(redacted.length).toBeGreaterThan(0);
    for (const paste of redacted) {
      expect(paste.revisions).toHaveLength(2);
      expect(paste.revisions[0].purgedAt).not.toBeNull();
      expect(paste.revisions[1].purgedAt).toBeNull();
      expect(paste.revisions[1].reason).toBe("redaction");
      // The two revisions must hash differently, or the redaction changed nothing.
      expect(paste.revisions[0].sha256).not.toBe(paste.revisions[1].sha256);
    }
  });
});
