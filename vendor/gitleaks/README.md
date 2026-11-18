# Vendored gitleaks rule set

`gitleaks.toml` is the upstream rule set from
[gitleaks/gitleaks](https://github.com/gitleaks/gitleaks), **MIT licensed** — see
`LICENSE`, which is their copyright notice and must travel with these rules.

- Fetched from `config/gitleaks.toml` on `master`, commit `5f6ec56cfa6f`.
- 222 rules.

## Why vendored rather than fetched at build time

A build that reaches the network is a build that fails when the network does, and a
rule set that changes without a commit changes what the product refuses to save
without anyone reviewing it. Re-vendor deliberately: replace both files, re-run
`pnpm secrets:compile`, and read the diff in the generated tier counts.

## Why not hand-written

ARCHITECTURE §6.1: ~170 maintained rules, and writing your own is how you ship a
scanner with 40 % recall. The tiering is ours; the patterns are not.

## Correction

Earlier revisions of ARCHITECTURE.md said this rule set was Apache-2.0. It is MIT.
The question was logged as open and due at M5; this is the answer.
