// Reproduces the README's threshold table (ARCHITECTURE §6.2, M12).
//
// THE NUMBERS EXISTED AND THE SCRIPT DID NOT. M5 measured Shiki by hand and wrote the
// results into the README, which is the pattern Appendix H keeps recording: a value written
// down rather than computed cannot be re-checked, and nobody notices when it stops being
// true. Shiki 4.7 ships, the grammar changes, the laptop is replaced — and the table still
// reads as measured evidence for a cutoff it no longer supports.
//
// So this is committed, and its output is what the README quotes. Run it before trusting
// any number in that table:
//
//   pnpm measure:thresholds
//
// The budget it tests is the DOM's, not the CPU's. §6.2's claim is that markup size rather
// than wall clock sets the 2 000-line cutoff, so HTML bytes are a measured column here and
// not a footnote — a run that only timed the highlighter would confirm the wrong constraint.

import { readFile } from "node:fs/promises";

import { highlight } from "@/lib/render/highlight";
import {
  HIGHLIGHT_BYTES,
  HIGHLIGHT_LINES,
  renderMode,
} from "@/lib/render/thresholds";

const LINE_COUNTS = [200, 2_000, 20_000, 100_000];

/** One line of real TypeScript, repeated. Grammar cost is the thing being measured, so a
 *  line with a string, a keyword and a comment is representative where `let x = 1` is not. */
const TS_LINE =
  "const value: Record<string, number> = { key: 1 }; // a trailing comment\n";

/** Plain text costs what a log costs: no grammar, no tokens beyond the span per line. */
const TEXT_LINE =
  "2026-11-19T10:14:22.481Z  INFO  worker-7  handled request in 31ms\n";

interface Row {
  lines: number;
  language: string;
  ms: number;
  htmlBytes: number;
  bytesPerLine: number;
}

async function measure(
  lines: number,
  language: string,
  line: string,
): Promise<Row> {
  const body = line.repeat(lines);

  // WARMED FIRST, then timed. Shiki's fixed cost is ~90 ms of WASM and grammar load, and
  // leaving it in the first row makes 200 lines look like 2 000 — which is a real finding
  // about the per-request case and noise when the question is per-line cost. The fixed
  // cost is reported separately below.
  await highlight(line, language);

  const started = performance.now();
  const html = await highlight(body, language);
  const ms = performance.now() - started;

  if (html === null) throw new Error(`no grammar for ${language}`);

  const htmlBytes = new TextEncoder().encode(html).length;
  return {
    lines,
    language,
    ms: Math.round(ms),
    htmlBytes,
    bytesPerLine: Math.round(htmlBytes / lines),
  };
}

/** The cold cost of the first call in a process, which is the per-request case's real bill. */
async function measureColdStart(): Promise<number> {
  const started = performance.now();
  await highlight("const x = 1;\n", "typescript");
  return Math.round(performance.now() - started);
}

function kb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Real code, not a repeated line — the check on everything above.
 *
 * A synthetic line measures one token density forever, and the figure that matters is
 * whether that density is representative. So the largest TypeScript file in this repo gets
 * measured as itself, and if its bytes/line is far from the synthetic row's, the synthetic
 * row is the thing to distrust.
 */
async function measureRealFile(): Promise<Row & { path: string }> {
  const path = "src/lib/server/create-paste.ts";
  const body = await readFile(path, "utf8");
  const lines = body.split("\n").length;

  await highlight("const x = 1;\n", "typescript");
  const started = performance.now();
  const html = await highlight(body, "typescript");
  const ms = performance.now() - started;
  const htmlBytes = new TextEncoder().encode(html!).length;

  return {
    path,
    lines,
    language: "typescript",
    ms: Math.round(ms),
    htmlBytes,
    bytesPerLine: Math.round(htmlBytes / lines),
  };
}

const cold = await measureColdStart();

const rows: Row[] = [];
for (const [language, line] of [
  ["typescript", TS_LINE],
  ["text", TEXT_LINE],
] as const) {
  for (const lines of LINE_COUNTS) {
    rows.push(await measure(lines, language, line));
  }
}

console.log(`\nCold start (first highlight in the process): ${cold} ms\n`);
console.log("| lines   | language   | wall clock | HTML   | bytes/line |");
console.log("| ------- | ---------- | ---------- | ------ | ---------- |");
for (const row of rows) {
  const name = row.language === "text" ? "plain text" : "TypeScript";
  console.log(
    `| ${String(row.lines).padEnd(7)} | ${name.padEnd(10)} | ${`${row.ms} ms`.padEnd(10)} | ${kb(row.htmlBytes).padEnd(6)} | ${String(row.bytesPerLine).padEnd(10)} |`,
  );
}

// THE VERDICT, COMPUTED RATHER THAN RESTATED. The README's prose argues the cutoff holds
// because the markup at 2 000 lines is affordable and at 20 000 is not. That argument is an
// inequality, so the script can check it — and say so if the next Shiki release moves the
// numbers out from under it.
const at = (lines: number, language: string) =>
  rows.find((r) => r.lines === lines && r.language === language)!;

const tsAtCutoff = at(HIGHLIGHT_LINES, "typescript");
const tsAbove = at(20_000, "typescript");

console.log(`\nThe ${HIGHLIGHT_LINES}-line cutoff:`);
console.log(
  `  at the cutoff        ${kb(tsAtCutoff.htmlBytes)} of markup, ${tsAtCutoff.ms} ms`,
);
console.log(
  `  one rung above       ${kb(tsAbove.htmlBytes)} of markup, ${tsAbove.ms} ms`,
);
console.log(
  `  the ladder sends a ${HIGHLIGHT_LINES}-line body to: ${renderMode(tsAtCutoff.lines * 70, HIGHLIGHT_LINES)}`,
);
console.log(
  `  and a ${(HIGHLIGHT_LINES + 1).toLocaleString()}-line body to: ${renderMode(0, HIGHLIGHT_LINES + 1)}`,
);

const real = await measureRealFile();
console.log(
  `\nReal file, as a check on the synthetic rows:\n  ${real.path} — ${real.lines} lines, ` +
    `${kb(real.htmlBytes)} of markup, ${real.bytesPerLine} bytes/line, ${real.ms} ms`,
);

// A byte cutoff would be wrong for one of the two languages whatever value it took, which
// is the reason §6.2 counts lines. Stated as a ratio so a future reader can see whether it
// still holds rather than taking the claim on faith.
const spread =
  at(2_000, "typescript").bytesPerLine / at(2_000, "text").bytesPerLine;
console.log(
  `\nMarkup per line, TypeScript vs plain text: ${spread.toFixed(1)}× — which is why the` +
    ` cutoff counts lines and not bytes.\n  (HIGHLIGHT_BYTES is ${kb(HIGHLIGHT_BYTES)}, the` +
    ` second half of the same gate.)\n`,
);
