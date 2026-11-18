// Re-vendors vendor/gitleaks/gitleaks.toml from upstream, with allowlist blocks
// stripped. Run with `pnpm secrets:vendor`.
//
// Why strip them: gitleaks' allowlists hold literal example credentials — 16 real-shape
// Google API keys among them — as documented false positives to ignore. The compiler
// never reads allowlists, GitHub's push protection would reject the file, and
// `no-committed-secrets.spec.ts` flags it. Keeping the rules and dropping the examples
// loses nothing and keeps a vendored third-party file committable.
//
// This is the one place the build may touch the network, and it is not part of `build`:
// re-vendoring is a deliberate act whose diff should be read, because it changes what
// the product refuses to save.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const RAW =
  "https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml";
const LICENSE =
  "https://raw.githubusercontent.com/gitleaks/gitleaks/master/LICENSE";
const DIR = join(import.meta.dirname, "../vendor/gitleaks");

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

/** Drops every `[[rules.allowlists]]` / `[rules.allowlist]` block, keeping the rule
 *  tables themselves. A block runs until the next table header at any depth. */
function stripAllowlists(toml: string): { out: string; dropped: number } {
  const lines = toml.split("\n");
  const kept: string[] = [];
  let skipping = false;
  let dropped = 0;

  for (const line of lines) {
    const header = /^\s*\[\[?([\w.]+)\]\]?\s*$/.exec(line);
    if (header !== null) {
      const isAllowlist = /allowlist/.test(header[1]);
      if (isAllowlist) dropped += 1;
      skipping = isAllowlist;
    }
    if (!skipping) kept.push(line);
  }
  return { out: kept.join("\n"), dropped };
}

const [toml, license] = await Promise.all([fetchText(RAW), fetchText(LICENSE)]);
const { out, dropped } = stripAllowlists(toml);

writeFileSync(join(DIR, "gitleaks.toml"), out, "utf8");
writeFileSync(join(DIR, "LICENSE"), license, "utf8");

const rules = (out.match(/^\[\[rules\]\]\s*$/gm) ?? []).length;
process.stdout.write(
  `vendored ${rules} rules, stripped ${dropped} allowlist block(s)\n`,
);
