// Compiles vendor/gitleaks/gitleaks.toml into src/lib/secrets/rules.generated.ts.
//
// Run with `pnpm secrets:compile`. Build, test and dev run it first, so the generated
// file is never committed — same rule as the render table.
//
// ARCHITECTURE §6.1: port the rules, do not write them. 222 maintained patterns beat
// anything hand-rolled, and the tiering is the part that is ours.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOML = join(import.meta.dirname, "../vendor/gitleaks/gitleaks.toml");
const OUT = join(import.meta.dirname, "../src/lib/secrets/rules.generated.ts");

/**
 * Tier 1 is a curated allowlist, not everything gitleaks ships.
 *
 * Tier 1 means **hard block, no override, for anyone including moderators** (§6.1).
 * Auto-promoting 222 third-party patterns to that would hand a vendored file the power
 * to wall a user out of their own paste with no way through, and the first
 * false positive in any of them becomes unanswerable. So the hard-block set is small,
 * deliberate and auditable: providers whose tokens carry an assigned fixed shape, where
 * a match is close to proof.
 *
 * Everything else gitleaks knows about still fires — as tier 2, which blocks with an
 * override path. That is the right default for a pattern nobody on this project has
 * read.
 */
const TIER_1_RULES = new Set([
  "aws-access-token",
  "github-pat",
  "github-fine-grained-pat",
  "github-oauth",
  "github-app-token",
  "github-refresh-token",
  "gitlab-pat",
  "gitlab-ptt",
  "gitlab-rrt",
  "slack-bot-token",
  "slack-user-token",
  "slack-app-token",
  "slack-config-access-token",
  "slack-config-refresh-token",
  "slack-legacy-bot-token",
  "slack-legacy-token",
  "slack-legacy-workspace-token",
  "openai-api-key",
  "anthropic-api-key",
  "gcp-api-key",
  "stripe-access-token",
  "sendgrid-api-token",
  "twilio-api-key",
  "private-key",
  "jwt",
  "npm-access-token",
  "pypi-upload-token",
  "digitalocean-pat",
  "doppler-api-token",
  "linear-api-key",
  "shopify-access-token",
  "shopify-shared-secret",
  "square-access-token",
  "atlassian-api-token",
  "age-secret-key",
]);

interface Rule {
  id: string;
  description: string;
  regex: string;
  entropy?: number;
  keywords: string[];
}

/** A minimal reader for the subset of TOML gitleaks uses: `[[rules]]` tables with
 *  string, number and string-array values, and ''' literal strings. A full TOML parser
 *  would be a dependency for one file with a known shape. */
function parseRules(toml: string): Rule[] {
  const rules: Rule[] = [];
  // Split on rule table headers, skipping the file preamble and any [rules.allowlist].
  const blocks = toml.split(/^\[\[rules\]\]\s*$/m).slice(1);

  for (const block of blocks) {
    // Stop at the first nested table: allowlists are not rules.
    const body = block.split(/^\[\[?rules\.[^\]]+\]\]?\s*$/m)[0];
    const id = matchString(body, "id");
    const regex = matchLiteral(body, "regex");
    if (id === null || regex === null) continue;
    const entropy = matchNumber(body, "entropy");
    rules.push({
      id,
      description: matchString(body, "description") ?? id,
      regex,
      ...(entropy === null ? {} : { entropy }),
      keywords: matchArray(body, "keywords"),
    });
  }
  return rules;
}

const matchString = (body: string, key: string) =>
  new RegExp(`^${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m").exec(body)?.[1] ??
  null;

const matchLiteral = (body: string, key: string) =>
  new RegExp(`^${key}\\s*=\\s*'''([\\s\\S]*?)'''`, "m").exec(body)?.[1] ??
  new RegExp(`^${key}\\s*=\\s*'([^']*)'`, "m").exec(body)?.[1] ??
  matchString(body, key);

const matchNumber = (body: string, key: string) => {
  const found = new RegExp(`^${key}\\s*=\\s*([\\d.]+)`, "m").exec(body)?.[1];
  return found === undefined ? null : Number(found);
};

const matchArray = (body: string, key: string) => {
  const found = new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m").exec(
    body,
  )?.[1];
  if (found === undefined) return [];
  return [...found.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
};

/**
 * Translates a Go RE2 pattern into a JavaScript one, or rejects it.
 *
 * The two dialects overlap but are not the same. `(?i)` is an inline flag in RE2 and a
 * syntax error in JavaScript, so it is lifted to the `i` flag. Anything else that will
 * not compile is dropped loudly rather than silently: a rule that throws at import
 * time would take the whole scanner down, and a rule quietly missing would make the
 * scanner weaker than the rule count claims.
 */
function toJsRegex(
  pattern: string,
): { source: string; flags: string; rewritten: boolean } | null {
  let source = pattern;
  let flags = "g";
  let rewritten = false;

  // `(?i)` is an inline flag in RE2 and a syntax error in JavaScript. At the start it
  // lifts cleanly to the `i` flag. Elsewhere it applies only from that point on, and
  // JavaScript has no equivalent — so the whole pattern becomes case-insensitive,
  // which matches *more* than upstream intended. That is safe for detection and not
  // safe for a hard block, so a rewritten rule is capped at tier 2 below.
  if (source.includes("(?i)")) {
    rewritten = !source.startsWith("(?i)");
    source = source.replaceAll("(?i)", "");
    flags += "i";
  }
  // Any other inline flag group is not translatable by simple means.
  if (/\(\?[a-zA-Z]+\)/.test(source)) return null;

  try {
    new RegExp(source, flags);
  } catch {
    return null;
  }
  return { source, flags, rewritten };
}

const all = parseRules(readFileSync(TOML, "utf8"));
const compiled: string[] = [];
const rejected: string[] = [];
const demoted: string[] = [];
let tier1 = 0;

for (const rule of all) {
  const translated = toJsRegex(rule.regex);
  if (translated === null) {
    rejected.push(rule.id);
    continue;
  }
  // A pattern we had to rewrite does not get to hard-block, even if it is on the
  // curated list: its semantics are no longer exactly what upstream reviewed.
  const curated = TIER_1_RULES.has(rule.id);
  const tier = curated && !translated.rewritten ? 1 : 2;
  if (tier === 1) tier1 += 1;
  if (curated && translated.rewritten) demoted.push(rule.id);
  compiled.push(
    `  {\n` +
      `    id: ${JSON.stringify(rule.id)},\n` +
      `    label: ${JSON.stringify(labelFor(rule))},\n` +
      `    tier: ${tier},\n` +
      `    source: ${JSON.stringify(translated.source)},\n` +
      `    flags: ${JSON.stringify(translated.flags)},\n` +
      `    keywords: ${JSON.stringify(rule.keywords.map((k) => k.toLowerCase()))},\n` +
      `  },`,
  );
}

/** gitleaks descriptions are sentences aimed at a report. A finding panel needs a
 *  noun phrase next to a line of the user's own text. */
function labelFor(rule: Rule): string {
  const cleaned = rule.description
    .replace(
      /^(?:Uncovered|Detected|Discovered|Identified|Found)\s+(?:a|an)\s+/i,
      "",
    )
    .replace(/,.*$/, "")
    .replace(/\.$/, "");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Every curated tier-1 id that did not end up as a tier-1 rule, for any reason:
 *  absent from the vendored toml, untranslatable, or demoted after a rewrite. The
 *  first version of this check only looked for ids missing from the toml, and quietly
 *  let `doppler-api-token` be dropped as untranslatable — a hard block that silently
 *  became no block, which is the one failure a vendored rule set must not hide. */
const unrealised = [...TIER_1_RULES].filter(
  (id) => !all.some((rule) => rule.id === id) || rejected.includes(id),
);

const file = `// GENERATED by scripts/compile-secret-rules.mts — do not edit.
// Run \`pnpm secrets:compile\` to regenerate.
//
// Source: vendor/gitleaks/gitleaks.toml (MIT, Zachary Rice — see vendor/gitleaks/LICENSE).
//
// ${compiled.length} rules: ${tier1} tier 1 (hard block, no override) and
// ${compiled.length - tier1} tier 2 (block with an override path). Tier 3 is not here —
// it is our own entropy rule, gated on tier-2 context, and lives in scan.ts.
//
// Regex sources are stored as strings rather than literals so each is compiled once,
// at module load, into a fresh RegExp per use. A shared /g regex carries lastIndex
// between calls and silently skips matches in everything after the first body it sees.

export interface CompiledRule {
  id: string;
  label: string;
  tier: 1 | 2;
  source: string;
  flags: string;
  /** Lower-cased literals from the pattern. A body containing none of a rule's
   *  keywords cannot match it, so this skips most rules on most bodies. */
  keywords: string[];
}

export const RULES: readonly CompiledRule[] = [
${compiled.join("\n")}
];
`;

writeFileSync(OUT, file, "utf8");

process.stdout.write(
  `compiled ${compiled.length} rules (${tier1} tier 1, ${compiled.length - tier1} tier 2)\n`,
);
if (rejected.length > 0) {
  process.stdout.write(
    `skipped ${rejected.length} with untranslatable patterns: ${rejected.slice(0, 6).join(", ")}${rejected.length > 6 ? ", …" : ""}\n`,
  );
}
if (demoted.length > 0) {
  process.stdout.write(
    `note: ${demoted.length} curated rule(s) capped at tier 2 after a pattern rewrite: ${demoted.join(", ")}\n`,
  );
}
if (unrealised.length > 0) {
  process.stdout.write(
    `WARNING: ${unrealised.length} curated tier-1 id(s) produced no tier-1 rule: ${unrealised.join(", ")}\n`,
  );
}
process.stdout.write(`wrote ${OUT}\n`);
