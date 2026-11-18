import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Catches the bug that cost a rejected push: a sample token assembled by concatenation
// in source — so the source itself is clean — and then baked into a committed file as a
// complete literal by a generator. That happened to src/lib/fixtures/renders.generated.ts
// and GitHub's push protection found it before we did.
//
// This project needs credential-shaped samples: one fixture paste carries a Slack token
// on line 88 because the moderation queue's open request is about it, and M5 needs a
// positive fixture per tier-1 rule. Keeping those out of the repo would make the
// scanner suite unrunnable in CI, which is where its false-positive gate lives. So the
// rule is: assemble tokens at runtime, never store one assembled — and enforce it here
// rather than relying on everyone remembering.
//
// Scope is `git ls-files`, the committed set. A gitignored build artifact is out of
// scope by design: it never reaches the remote.

/** Tier-1 shapes from ARCHITECTURE §6.1 — the ones a provider assigns a fixed form.
 *
 *  Deliberately NOT global. A /g regex reused across files carries `lastIndex` between
 *  calls and silently skips matches in every file after the first, which would leave
 *  this guard green while under-reporting. `matchAll` below needs a global flag, so it
 *  gets a fresh one per file rather than sharing state.
 *
 *  None of these patterns matches its own source text: each needs a quantified run of
 *  characters the pattern itself does not contain. If you add one that is a bare
 *  literal, build it from parts the way the fixtures do. */
const TIER_1 = [
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[A-Z2-7]{16}\b/ },
  {
    name: "GitHub token",
    re: /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b/,
  },
  {
    name: "Slack token",
    re: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24}\b/,
  },
  { name: "Secret API key", re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    name: "Private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "JSON web token",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
] as const;

/** Binary files have nothing to scan and would decode as noise. */
const BINARY =
  /\.(ico|png|jpe?g|gif|webp|avif|woff2?|ttf|otf|eot|pdf|zip|wasm|mp4)$/i;

/** Large enough to be a vendored blob rather than source. The lock file is the only
 *  big text file here and is worth scanning, so the cap is generous. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

/** Derived rather than hardcoded, so renaming this file cannot silently disable the
 *  exclusion. The patterns above do not self-match, but that is easy to break when
 *  adding a rule, and a guard that quietly stops covering itself is the wrong failure. */
const SELF = relative(process.cwd(), fileURLToPath(import.meta.url));

function committedFiles(): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  } catch (cause) {
    // Say what could not be determined. A raw spawn error inside a security assertion
    // reads as "a secret was found", which is the opposite of the truth.
    throw new Error(
      "cannot list committed files: `git ls-files` failed, so this guard cannot " +
        "verify anything. Run the suite inside the git working tree.",
      { cause },
    );
  }
  return (
    out
      .split("\0")
      .filter(Boolean)
      .filter((file) => file !== SELF && !BINARY.test(file))
      // `git ls-files` reports the index, not the working tree. A tracked file can be
      // absent mid-rebase, during a merge conflict, or after a plain `rm` — there is
      // nothing to scan, and `statSync` would otherwise throw ENOENT from inside a
      // security check and look like a finding. The floor below keeps skipping from
      // making the guard vacuous.
      .filter((file) => existsSync(file))
  );
}

describe("committed files", () => {
  it("contains no credential-shaped literal", () => {
    const files = committedFiles();
    // A guard that silently scanned nothing would be worse than no guard.
    expect(files.length).toBeGreaterThan(10);

    const hits: string[] = [];
    for (const file of files) {
      if (statSync(file).size > MAX_SCAN_BYTES) continue;
      const text = readFileSync(file, "utf8");
      for (const { name, re } of TIER_1) {
        // Every match, not just the first: a guard that reports one hit per file makes
        // you fix, re-run, and discover the next one.
        for (const match of text.matchAll(new RegExp(re, "g"))) {
          const line = text.slice(0, match.index).split("\n").length;
          // Location and rule only, never the matched text: a failure message that
          // echoes the secret moves it into CI logs.
          hits.push(`${file}:${line} — ${name}`);
        }
      }
    }

    expect(
      hits,
      "assemble sample tokens at runtime instead of storing them whole, and keep " +
        "generated artifacts out of git",
    ).toEqual([]);
  });
});
