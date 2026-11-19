// The create path's two refusals, in a module that imports almost nothing.
//
// SEPARATE FROM `create-paste.ts` FOR ONE REASON, and it is not tidiness. Catching these
// requires `instanceof`, so a caller needs a real import rather than a type-only one — and
// `create-paste.ts` pulls in the highlighter, because stage 8 renders. The fork action
// caught both classes, which put Shiki in the view page's module graph and broke N2's
// stated zero. `view-route-imports.spec.ts` failed on exactly that trail:
//
//   src/app/p/[id]/page.tsx → src/actions/fork.ts → create-paste.ts → highlight.ts → shiki
//
// An error class is the thing every caller of a module needs and the thing that should cost
// them the least to import. Keeping them here makes that true by construction.

import "server-only";

import type { Finding } from "@/lib/types";

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
