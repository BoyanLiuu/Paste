// Replacing matched spans with «redacted:<rule-id>», then scanning again.
//
// At create time this is pure string work, because nothing has been written yet: the
// secret never had an identifier, so there is nothing to purge and no audit trail to
// write. That is the cheap path §6.1 exists to make common. The expensive one — a
// moderator redacting a live paste, which creates revision 2 and destroys revision 1's
// bytes — is M11.

import { scan, type ScanResult } from "@/lib/secrets/scan";
import type { Finding } from "@/lib/types";

export function placeholderFor(ruleId: string): string {
  // The rule id, not a generic marker: a reader six months later learns what kind of
  // thing was removed, which is usually the question they have.
  return `«redacted:${ruleId}»`;
}

export interface RedactResult {
  body: string;
  /** How many spans were replaced, so the UI can say — and so the staggered reveal
   *  has something to count (Appendix E). */
  replaced: number;
  /** The scan of the result. Not optional: see below. */
  rescan: ScanResult;
}

/**
 * Replaces every given span and re-scans.
 *
 * **Descending order is the correctness argument, not an optimisation.** Each
 * replacement changes the length of its line, so applying them top-down shifts every
 * later finding's columns and the second replacement lands in the wrong place — which
 * corrupts the user's text while looking like it worked. Bottom-up, every offset not
 * yet used is still valid.
 *
 * The re-scan is equally non-optional. The text changed, and a second secret can sit
 * inside or adjacent to the one just replaced, so "redact" must not imply "clean".
 */
export function redact(
  body: string,
  findings: readonly Finding[],
): RedactResult {
  const lines = body.split("\n");

  const ordered = [...findings].toSorted(
    (a, b) => b.line - a.line || b.colStart - a.colStart,
  );

  let replaced = 0;
  for (const finding of ordered) {
    const line = lines[finding.line - 1];
    // A finding whose line no longer exists, or whose columns fall outside it, is from
    // a stale scan. Skip it rather than splicing at a guessed offset: a wrong
    // replacement is worse than a missed one, because the user believes it worked.
    if (line === undefined) continue;
    const start = finding.colStart - 1;
    const end = finding.colEnd - 1;
    if (start < 0 || end > line.length || end <= start) continue;

    lines[finding.line - 1] =
      line.slice(0, start) + placeholderFor(finding.rule) + line.slice(end);
    replaced += 1;
  }

  const result = lines.join("\n");
  return { body: result, replaced, rescan: scan(result) };
}
