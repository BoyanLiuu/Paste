// The scanner (ARCHITECTURE §6.1).
//
// Runs synchronously inside the create request, before the insert, so a blocked body
// never gets an identifier and therefore never has a URL. Everything here is shaped by
// that: a keyword prefilter so 220 rules do not each walk the body, a wall-clock
// budget, and an entropy rung that refuses to fire without nearby context.

import { RULES, type CompiledRule } from "@/lib/secrets/rules.generated";
import type { Finding } from "@/lib/types";

/** §6.1's budget. Past it the scan reports what it has and says it is partial. */
export const SCAN_BUDGET_MS = 150;

/** Bodies up to here are scanned whole; above it only the first slice is, and the rest
 *  is left to a background pass. Blocking a create on a 20 MB scan is the worse trade. */
export const SCAN_WHOLE_BYTES = 256 * 1024;
export const SCAN_PREFIX_BYTES = 1024 * 1024;

export type ScanState = "complete" | "partial";

export interface ScanResult {
  findings: Finding[];
  state: ScanState;
  /** Lines actually examined, so the UI can say what was not. */
  linesScanned: number;
  /** Wall clock, for the budget test and the create path's logging. */
  elapsedMs: number;
}

/** Shannon entropy in bits per character. */
export function shannon(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Never the secret: first four and last four characters only (§6.1). A table of
 *  extracted credentials is a better target than the pastes they came from. */
export function preview(value: string): string {
  if (value.length <= 10) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Values that look like secrets and are not.
 *
 * Tier 2 matches an assignment to a secret-shaped name, which is exactly how
 * documentation, templates and `.env.example` files are written. Without this the
 * scanner's first act on a sample config is to refuse it.
 */
const PLACEHOLDER =
  /^(?:<.*>|\$\{.*\}|\$[A-Z_]+|\{\{.*\}\}|x+|\*+|\.\.\.|changeme|change_me|example|test|dummy|your[-_.].*|my[-_.].*|placeholder|redacted|none|null|nil|true|false|password|secret|todo)$|^«redacted:/i;

const HIGH_ENTROPY_RUN = /[A-Za-z0-9+/_=-]{32,}/g;
const ENTROPY_FLOOR = 4.5;

/**
 * Words that make a nearby random-looking string worth flagging.
 *
 * The gate is the whole point of the entropy rung. Ungated it fires on git SHAs,
 * UUIDs, base64 PNG headers, minified JavaScript and checksum manifests until people
 * learn to click through every warning — at which point the scanner has negative
 * value, because it has trained its users to dismiss it.
 */
const ENTROPY_CONTEXT =
  /token|secret|key|auth|bearer|credential|signing|passwd|password|api[-_]?key|private/i;

interface Span {
  start: number;
  end: number;
}

function unquote(value: string): string {
  return value
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .trim();
}

/** Compiled once per rule, not once per body: building 220 RegExp objects per scan is
 *  waste, and a shared /g object carries lastIndex between bodies. */
const COMPILED = new Map<string, RegExp>();
function regexFor(rule: CompiledRule): RegExp {
  let cached = COMPILED.get(rule.id);
  if (cached === undefined) {
    cached = new RegExp(rule.source, rule.flags);
    COMPILED.set(rule.id, cached);
  }
  cached.lastIndex = 0;
  return cached;
}

export function scan(body: string, now = () => performance.now()): ScanResult {
  const started = now();

  const bytes = new TextEncoder().encode(body).length;
  const text =
    bytes <= SCAN_WHOLE_BYTES ? body : body.slice(0, SCAN_PREFIX_BYTES);
  // "Partial" means text was skipped, not merely that the body was large. A 300 KB
  // body is over the whole-scan threshold and still fits inside the prefix, so all of
  // it was examined — reporting partial there would send the caller to queue a
  // background pass over nothing.
  const truncated = text.length < body.length;

  const lines = text.split("\n");
  const lowerBody = text.toLowerCase();

  // A body containing none of a rule's keywords cannot match it. This is what makes
  // 220 rules affordable inside the budget: most bodies skip most rules without ever
  // running a regex.
  const applicable = RULES.filter(
    (rule) =>
      rule.keywords.length === 0 ||
      rule.keywords.some((keyword) => lowerBody.includes(keyword)),
  )
    // TIER ORDER MATTERS, and getting it wrong inverts the security model.
    //
    // A span is claimed by the first rule to match it, so iterating in compiled order
    // let `generic-api-key` — tier 2, overridable — take the span belonging to
    // `slack-bot-token` or `github-pat`. A real provider token then arrived as a
    // warning with a way through instead of a hard block. Specific before generic, so
    // the strongest claim on a span wins it.
    .toSorted((a, b) => a.tier - b.tier);

  // Line starts, so a whole-text offset can be reported as a line and column.
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const locate = (offset: number) => {
    // Binary search: a linear scan per match is O(lines × matches) on a 200k-line body.
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };

  const findings: Finding[] = [];
  const taken: Span[] = [];
  let state: ScanState = truncated ? "partial" : "complete";

  // Rules run against the WHOLE text, not line by line.
  //
  // A line-based loop cannot match a multi-line pattern, and gitleaks' private-key
  // rule is exactly that: `-----BEGIN … PRIVATE KEY-----`, then at least 64 characters
  // of body, then the footer. Scanning per line meant a private key — one of the
  // headline tier-1 families — could never be detected at all.
  for (const rule of applicable) {
    if (now() - started > SCAN_BUDGET_MS) {
      // Report what was found rather than throwing it away, and say the scan is
      // incomplete so the caller can queue the rest. Never silently skip.
      state = "partial";
      break;
    }

    const regex = regexFor(rule);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match[0] === "") {
        // A zero-length match would spin forever.
        regex.lastIndex += 1;
        continue;
      }

      // Prefer the last non-empty capture group: gitleaks puts the secret there when a
      // pattern has to match surrounding context to find it. Falling back to the whole
      // match keeps the span safe to redact even when there is no group.
      const groups = match.slice(1).filter((g) => g !== undefined && g !== "");
      const value = groups.at(-1) ?? match[0];
      const offset = match[0].indexOf(value);
      const start = match.index + (offset === -1 ? 0 : offset);
      const end = start + value.length;

      if (overlaps(taken, start, end)) continue;
      // Unwrap quotes before judging: the match often includes them, and `"changeme"`
      // is as much a placeholder as `changeme`.
      if (rule.tier === 2 && PLACEHOLDER.test(unquote(value))) continue;

      taken.push({ start, end });
      const at = locate(start);
      findings.push({
        rule: rule.id,
        label: rule.label,
        tier: rule.tier,
        line: at.line,
        colStart: at.column,
        colEnd: at.column + value.length,
        preview: preview(value),
      });
    }
  }

  // Tier 3 last, so it can see every span tiers 1 and 2 already claimed.
  for (const [index, line] of lines.entries()) {
    for (const finding of entropyFindings(
      line,
      lines[index - 1] ?? "",
      index,
      taken,
      lineStarts[index] ?? 0,
    )) {
      findings.push(finding);
    }
  }

  return {
    findings: findings.toSorted(
      (a, b) => a.line - b.line || a.colStart - b.colStart || a.tier - b.tier,
    ),
    state,
    linesScanned: lines.length,
    elapsedMs: now() - started,
  };
}

function entropyFindings(
  line: string,
  previous: string,
  index: number,
  taken: Span[],
  /** Where this line starts in the whole text, so its spans are comparable with the
   *  whole-text spans tiers 1 and 2 claimed. */
  lineStart: number,
): Finding[] {
  const out: Finding[] = [];
  const regex = new RegExp(HIGH_ENTROPY_RUN.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    const value = match[0];
    const start = match.index;
    const end = start + value.length;

    if (overlaps(taken, lineStart + start, lineStart + end)) continue;
    if (shannon(value) < ENTROPY_FLOOR) continue;

    // The gate: secret-ish wording in what precedes the run, on this line or the one
    // before. Without it this rung is a false-positive generator.
    const context = `${previous} ${line.slice(0, start)}`;
    if (!ENTROPY_CONTEXT.test(context)) continue;

    taken.push({ start: lineStart + start, end: lineStart + end });
    out.push({
      rule: "high-entropy-near-secret",
      label: "Random-looking string next to a secret word",
      tier: 3,
      line: index + 1,
      colStart: start + 1,
      colEnd: end + 1,
      preview: preview(value),
    });
  }
  return out;
}

function overlaps(taken: readonly Span[], start: number, end: number): boolean {
  return taken.some((span) => start < span.end && end > span.start);
}

/** The highest tier present, which is what the create path branches on. Tier 1 is a
 *  hard refusal; tier 2 and 3 offer a way through. */
export function worstTier(findings: readonly Finding[]): 1 | 2 | 3 | null {
  if (findings.some((f) => f.tier === 1)) return 1;
  if (findings.some((f) => f.tier === 2)) return 2;
  if (findings.some((f) => f.tier === 3)) return 3;
  return null;
}
