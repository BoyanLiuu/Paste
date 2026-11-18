// The detection ladder (ARCHITECTURE §A.1). Every rung is cheaper and more precise
// than the one below it, and the first match wins. The order is the design.
//
//   1. explicit selection     ALWAYS WINS, never second-guessed
//   2. filename extension
//   3. first-line sniff
//   4. LOG DETECTOR           before any scorer — see log-detector.ts
//   5. highlight.js, scored   ~25 grammars, relevance floor
//   6. plaintext
//
// Falling through to plaintext is a **correct answer**. Unhighlighted text beats text
// highlighted as the wrong language, which actively misleads — so rung 5 has a floor
// and rung 6 is a real destination rather than a failure.

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

import { languageForFilename } from "@/lib/detect/extensions";
import { detectLog } from "@/lib/detect/log-detector";
import type { LanguageSource } from "@/lib/types";

// Registered individually rather than importing the full bundle: `highlight.js` ships
// 190+ grammars and `highlightAuto` over all of them on a 30-line snippet is close to
// a random choice weighted by grammar verbosity. A ~25-language subset is useful.
const SUBSET: Readonly<Record<string, unknown>> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  markdown,
  php,
  python,
  ruby,
  rust,
  scala,
  shell,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, grammar] of Object.entries(SUBSET)) {
  hljs.registerLanguage(name, grammar as never);
}

/** Below this, highlight.js is guessing. Returning nothing and letting plaintext win
 *  is the better answer — §A.1. */
const RELEVANCE_FLOOR = 10;

/**
 * And it has to clear a *rate*, not just a total.
 *
 * highlight.js relevance accumulates with length, so an absolute floor means different
 * things on a 20-line body and a 2000-line one. Measured on this project's own corpus:
 *
 *   PY      python      66 over  40 lines = 1.65 per line
 *   BASH    bash        31 over  14 lines = 2.21
 *   DOCKER  dockerfile  31 over  22 lines = 1.41
 *   SQL     sql         34 over  26 lines = 1.31
 *   NOTES   (prose)     10 over  17 lines = 0.59   <- reached the absolute floor
 *   LAPTOP  (prose)      5 over  16 lines = 0.31
 *
 * The incident notes scored exactly 10 as SQL and would have been highlighted as SQL.
 * Real code sits at 1.3 and above, prose below 0.6, so 1.0 has margin on both sides.
 */
const RELEVANCE_PER_LINE = 1;

/** Enough of the body for the scorer to judge without walking a 20 MB log. */
const SCORE_SAMPLE_BYTES = 16 * 1024;

export interface Detection {
  language: string;
  source: LanguageSource;
}

export interface DetectInput {
  body: string;
  /** An explicit choice from the form or the API. Always wins. */
  language?: string | null;
  /** From `curl -F 'f=@deploy.yaml'`. The web form has none. */
  filename?: string | null;
}

export function resolveLanguage({
  body,
  language,
  filename,
}: DetectInput): Detection {
  // 1. Explicit. Never second-guessed, even when every other rung disagrees — the
  //    user looked at their own text and told us.
  if (
    language !== null &&
    language !== undefined &&
    language !== "" &&
    language !== "auto"
  ) {
    return { language, source: "explicit" };
  }

  // 2. The filename, when there is one.
  if (filename !== null && filename !== undefined) {
    const byName = languageForFilename(filename);
    if (byName !== null) return { language: byName, source: "filename" };
  }

  // 3. First-line sniff: cheap, decisive, and right far more often than a scorer.
  const sniffed = sniffFirstLine(body);
  if (sniffed !== null) return { language: sniffed, source: "firstline" };

  // 4. The log detector, before any scorer.
  if (detectLog(body).isLog) return { language: "log", source: "firstline" };

  // 5. The scorer, restricted and floored.
  const scored = scoreLanguage(body);
  if (scored !== null) return { language: scored, source: "scored" };

  // 6. Plaintext, which is an answer.
  return { language: "plaintext", source: "fallback" };
}

function sniffFirstLine(body: string): string | null {
  const trimmed = body.trimStart();
  const firstLine = trimmed.split("\n", 1)[0] ?? "";

  // A shebang names its own interpreter.
  const shebang =
    /^#!.*\b(python[\d.]*|node|bash|sh|zsh|ruby|perl|php|deno)\b/.exec(
      firstLine,
    );
  if (shebang !== null) {
    const found = shebang[1];
    if (found.startsWith("python")) return "python";
    if (found === "node" || found === "deno") return "javascript";
    if (found === "sh" || found === "zsh") return "bash";
    return found;
  }

  if (/^<\?xml\b/.test(firstLine)) return "xml";
  if (/^<\?php\b/.test(firstLine)) return "php";
  if (/^<!doctype html\b/i.test(firstLine)) return "html";
  if (/^diff --git /.test(firstLine)) return "diff";
  if (/^FROM\s+\S+/i.test(firstLine) && /^FROM /im.test(trimmed)) {
    return "dockerfile";
  }

  // Whole-body JSON. Guarded on the first character so a 10 MB log is not handed to
  // JSON.parse to find out it is not JSON.
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not JSON; fall through rather than guessing.
    }
  }

  // A YAML document marker plus plausible following lines. Deliberately shallow: a
  // real parse would be a dependency and a document that fails it is still YAML.
  if (/^---\s*$/.test(firstLine)) {
    const next = trimmed.split("\n").slice(1, 21);
    const yamlish = next.filter(
      (line) => line.trim() === "" || /^\s*(?:#|-\s|[\w.-]+\s*:)/.test(line),
    );
    if (next.length > 0 && yamlish.length / next.length >= 0.7) return "yaml";
  }

  return null;
}

function scoreLanguage(body: string): string | null {
  const sample = body.slice(0, SCORE_SAMPLE_BYTES);
  if (sample.trim() === "") return null;

  const result = hljs.highlightAuto(sample, Object.keys(SUBSET));
  if (result.language === undefined) return null;

  const relevance = result.relevance ?? 0;
  if (relevance < RELEVANCE_FLOOR) return null;

  const lines = Math.max(1, sample.trim().split("\n").length);
  if (relevance / lines < RELEVANCE_PER_LINE) return null;

  return result.language;
}
