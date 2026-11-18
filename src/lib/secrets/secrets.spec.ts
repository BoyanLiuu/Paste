import { describe, expect, it } from "vitest";

import { RULES } from "@/lib/secrets/rules.generated";
import { redact } from "@/lib/secrets/redact";
import {
  SCAN_BUDGET_MS,
  SCAN_PREFIX_BYTES,
  SCAN_WHOLE_BYTES,
  scan,
  shannon,
  worstTier,
} from "@/lib/secrets/scan";

// Every credential-shaped string here is assembled from parts, never written whole.
// `no-committed-secrets.spec.ts` enforces that, and it exists because a sample token
// baked into a committed file is what got a push rejected.

const AWS = "AKIA" + "Q3EGTN5RZK7XW2PD";
const AWS_EXAMPLE = "AKIA" + "IOSFODNN7EXAMPLE";
const SLACK =
  "xo" + "xb-" + "1234567890123-1234567890123-" + "SAMPLEsampleSAMPLEsample";
const GITHUB = "ghp_" + "A".repeat(36);
const OPENAI =
  "sk-" + "a1b2c3d4e5f6g7h8i9j0" + "T3Blbk" + "FJ" + "k1l2m3n4o5p6q7r8s9t0";
const GOOGLE = "AIza" + "C".repeat(35);
// gitleaks requires the block, not just the header — a bare header appears in
// documentation constantly, so demanding the body is the lower-false-positive choice.
const PEM =
  "-----BEGIN " +
  "RSA PRIVATE KEY-----\n" +
  "MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n" +
  "KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQ==\n" +
  "-----END " +
  "RSA PRIVATE KEY-----";
const JWT =
  "eyJ" +
  "hbGciOiJIUzI1NiJ9." +
  "eyJzdWIiOiIxMjM0NTYifQ." +
  "dBjftJeZ4CVPmB92K27u";

describe("the compiled rule set", () => {
  it("has rules in both tiers", () => {
    expect(RULES.length).toBeGreaterThan(150);
    expect(RULES.filter((r) => r.tier === 1).length).toBeGreaterThan(20);
    expect(RULES.filter((r) => r.tier === 2).length).toBeGreaterThan(100);
  });

  it("compiles every pattern", () => {
    // A rule that throws at use would take the scanner down mid-request.
    for (const rule of RULES) {
      expect(() => new RegExp(rule.source, rule.flags)).not.toThrow();
    }
  });

  it("keeps the hard-block set small and deliberate", () => {
    // Tier 1 cannot be overridden by anyone, so it must not be "whatever the vendored
    // file happened to ship". A large tier 1 means the first false positive in a
    // pattern nobody read becomes an unanswerable wall (§6.1).
    const tier1 = RULES.filter((r) => r.tier === 1);
    expect(tier1.length).toBeLessThan(60);
  });
});

describe("tier 1 — the hard block", () => {
  it.each([
    ["an AWS access key id", `aws_access_key_id = ${AWS}`],
    ["a Slack bot token", `SLACK_BOT_TOKEN=${SLACK}`],
    ["a GitHub personal access token", `token: ${GITHUB}`],
    ["an OpenAI key", `OPENAI_API_KEY=${OPENAI}`],
    ["a Google API key", `key=${GOOGLE}`],
    ["a private key header", PEM],
    ["a JSON web token", `Authorization: Bearer ${JWT}`],
  ])("refuses %s", (_name, body) => {
    const result = scan(body);
    expect(worstTier(result.findings)).toBe(1);
  });

  it("locates a finding to its line and column", () => {
    // The finding is rendered against the user's own text, so the coordinates are the
    // product, not debug output (§6.1).
    const body = `[default]\nregion = eu-west-1\naws_access_key_id = ${AWS}\n`;
    const [finding] = scan(body).findings;
    expect(finding.line).toBe(3);
    expect(finding.colStart).toBe(21);
    expect(finding.colEnd).toBe(21 + AWS.length);
  });

  it("never puts the secret in the preview", () => {
    // A findings table full of extracted credentials is a better target than the
    // pastes they came from.
    const finding = scan(`aws_access_key_id = ${AWS}`).findings[0];
    expect(finding.preview).not.toContain(AWS);
    expect(finding.preview).toBe(`${AWS.slice(0, 4)}…${AWS.slice(-4)}`);
  });
});

describe("tier 2 and the placeholder guard", () => {
  it("flags a real password assignment", () => {
    const result = scan('password = "winter-kettle-42"');
    expect(worstTier(result.findings)).toBe(2);
  });

  it.each([
    'password = "<your-password-here>"',
    "password = ${DB_PASSWORD}",
    "password = $DB_PASSWORD",
    'password = "changeme"',
    'api_key = "example"',
    'secret = "xxxxxxxxxxxx"',
    'token = "«redacted:generic-api-key»"',
    "password = {{ .Values.password }}",
  ])("ignores the placeholder %s", (body) => {
    // Tier 2 matches the shape documentation and .env.example files are written in.
    // Without this the scanner's first act on a sample config is to refuse it.
    expect(scan(body).findings.filter((f) => f.tier === 2)).toEqual([]);
  });
});

describe("tier 3 — entropy, gated on context", () => {
  it("flags a high-entropy run next to a secret word", () => {
    const blob = "Zm9vYmFyYmF6cXV1eHF1dXhjb3JnZWdyYXVsdHNlY3JldA";
    const findings = scan(`signing_token: ${blob}`).findings;
    expect(findings.some((f) => f.tier === 3 || f.tier === 2)).toBe(true);
  });

  // The negatives are the valuable half of this suite. Ungated entropy fires on all of
  // these until people learn to click through every warning — at which point the
  // scanner has negative value, because it has trained its users to dismiss it.
  it.each([
    ["a git SHA", "commit 3f8a2b1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a"],
    ["a UUID", "request_id 7c9e6679-7425-40de-944b-e07fc1f90ae7"],
    [
      "a base64 PNG header",
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI",
    ],
    ["a Kubernetes resource version", "resourceVersion: 884213771284001923"],
    ["a checksum manifest line", "d41d8cd98f00b204e9800998ecf8427e  empty.txt"],
    ["a minified line", '!function(e,t){"object"==typeof exports&&t(exports)}'],
    ["AWS's own documented example key", `aws_access_key_id = ${AWS_EXAMPLE}`],
  ])("does not flag %s", (_name, body) => {
    const findings = scan(body).findings;
    expect(findings.filter((f) => f.tier === 3)).toEqual([]);
  });

  it("measures entropy the way the gate expects", () => {
    expect(shannon("aaaaaaaa")).toBeCloseTo(0, 5);
    expect(shannon("abcdefgh")).toBeCloseTo(3, 5);
    expect(shannon("Zm9vYmFyYmF6cXV1eHF1dXhjb3JnZQ")).toBeGreaterThan(4);
  });

  it("measures a false-positive rate over a realistic corpus", () => {
    // §6.1 treats anything above 2 % as a bug in the rules rather than in the users.
    // This is a smaller corpus than the 200 real pastes the plan calls for, so it is a
    // floor on confidence rather than the measurement itself.
    const clean = [
      "const x = 1;\nexport default x;",
      "SELECT id FROM orders WHERE status = 'paid';",
      "resourceVersion: 884213771284001923",
      "commit 3f8a2b1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a",
      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "FROM node:22-bookworm-slim\nRUN corepack enable",
      "d41d8cd98f00b204e9800998ecf8427e  empty.txt",
      'password = "<your-password-here>"',
      "replicaCount: 2\nimage:\n  tag: 2026.11.04-3",
      "2026-11-12T07:41:03.188Z INFO payments-api status=200 dur=42ms",
    ];
    const flagged = clean.filter((body) => scan(body).findings.length > 0);
    expect(flagged, `flagged: ${flagged.join(" | ")}`).toEqual([]);
  });
});

describe("the budget", () => {
  it("scans a 256 KB body inside its budget", () => {
    const line = "const value = compute(input);\n";
    const body = line.repeat(Math.ceil(SCAN_WHOLE_BYTES / line.length));
    const result = scan(body);
    expect(result.state).toBe("complete");
    // Generous against a cold JIT and a shared CI box; the point is the order of
    // magnitude, not the exact figure.
    expect(result.elapsedMs).toBeLessThan(SCAN_BUDGET_MS * 6);
  });

  it("reports complete when the body was large but nothing was skipped", () => {
    // Over the whole-scan threshold and still inside the prefix, so every byte was
    // examined. Calling that "partial" would send the caller to queue a background
    // pass over nothing — an earlier version of this test asserted exactly that.
    const body = "x".repeat(SCAN_WHOLE_BYTES + 1024);
    expect(scan(body).state).toBe("complete");
  });

  it("reports partial when text really was skipped", () => {
    // A scan that quietly examined a tenth of the body and said nothing would be worse
    // than no scan: the caller would treat the rest as clean.
    const body = "x".repeat(SCAN_PREFIX_BYTES + 1024);
    const result = scan(body);
    expect(result.state).toBe("partial");
    expect(result.linesScanned).toBeLessThan(body.split("\n").length + 1);
  });

  it("stops at the budget and says so", () => {
    // A fake clock, so the assertion is about the behaviour rather than the hardware.
    // Each read jumps 100 ms, so the budget is spent after two rules whatever the
    // machine is doing.
    let t = 0;
    const result = scan(
      'password = "hunter2"\n'.repeat(5000),
      () => (t += 100),
    );
    expect(result.state).toBe("partial");
  });
});

describe("redaction", () => {
  it("replaces a span with the rule id", () => {
    const body = `aws_access_key_id = ${AWS}`;
    const { body: out, replaced } = redact(body, scan(body).findings);
    expect(replaced).toBe(1);
    expect(out).toContain("«redacted:aws-access-token»");
    expect(out).not.toContain(AWS);
  });

  it("handles two findings on one line", () => {
    // The bug descending order exists to prevent: replacing top-down shifts the second
    // finding's columns, so it lands in the wrong place and corrupts the text while
    // appearing to work.
    const body = `a=${AWS} b=${GITHUB}`;
    const { body: out, replaced } = redact(body, scan(body).findings);
    expect(replaced).toBe(2);
    expect(out).not.toContain(AWS);
    expect(out).not.toContain(GITHUB);
    expect(out).toMatch(/^a=«redacted:[a-z-]+» b=«redacted:[a-z-]+»$/);
  });

  it("re-scans, because redacting can reveal another finding", () => {
    const body = `key1 = ${AWS}\nkey2 = ${SLACK}\n`;
    const first = scan(body).findings.filter(
      (f) => f.rule === "aws-access-token",
    );
    const result = redact(body, first);
    // Only the AWS one was redacted, so the Slack token is still there — and the
    // re-scan says so rather than letting "redacted" imply "clean".
    expect(result.rescan.findings.length).toBeGreaterThan(0);
    expect(result.body).toContain(SLACK);
  });

  it("leaves the body clean when every finding is redacted", () => {
    const body = `aws = ${AWS}\nslack = ${SLACK}\n`;
    const result = redact(body, scan(body).findings);
    expect(result.rescan.findings).toEqual([]);
  });

  it("skips a finding from a stale scan rather than splicing at a guess", () => {
    // A wrong replacement is worse than a missed one: the user believes it worked.
    const body = "short line\n";
    const stale = [
      {
        rule: "aws-access-token",
        label: "AWS",
        tier: 1 as const,
        line: 9,
        colStart: 1,
        colEnd: 20,
        preview: "AKIA…MPLE",
      },
    ];
    const result = redact(body, stale);
    expect(result.replaced).toBe(0);
    expect(result.body).toBe(body);
  });
});
