// The one Shiki highlighter, used by the fixture script and by the save-time render in
// §4 stage 8. Two renderers producing the same markup is the requirement; one renderer
// used twice is how you actually get it.
//
// SERVER ONLY, and never on a read path. §6.2's whole argument is that highlighting
// happens once, at save, and the view page ships stored HTML — `view-route-imports.spec`
// fails if this module ever becomes reachable from the view route.

import {
  addClassToHast,
  createCssVariablesTheme,
  createHighlighter,
  type Highlighter,
} from "shiki";

import { classForDeclaration } from "@/lib/render/tokens";

export const THEME_NAME = "paste";

/**
 * Grammar ids Shiki knows, for classifications that are ours rather than TextMate's.
 *
 * `log` is this project's own category from the detection ladder, not a grammar, so it
 * renders as plaintext.
 */
const GRAMMAR: Record<string, string> = {
  log: "text",
  plaintext: "text",
};

export function grammarFor(language: string): string {
  return GRAMMAR[language] ?? language;
}

/**
 * Moves Shiki's inline `style` attribute onto a class from the shared vocabulary.
 *
 * The transformer is the mechanism §6.5 depends on. Measured at M5: without it, ten
 * fixture pastes carried 674 style attributes between them.
 */
function moveStyleToClass(node: { properties?: Record<string, unknown> }) {
  const style = node.properties?.style;
  if (typeof style !== "string") return;
  delete node.properties!.style;
  addClassToHast(node as never, classForDeclaration(style));
}

const styleToClassTransformer = {
  name: "style-to-class",
  span: moveStyleToClass,
  pre: moveStyleToClass,
};

/**
 * A body ending in "\n" makes Shiki emit a trailing empty line.
 *
 * That produced 41 line elements for a 40-line paste, so `#L41` existed in the DOM while
 * `parseRange` refused it as past the end. Strip it so the markup and the stored
 * `line_count` describe the same thing.
 */
export function stripTrailingNewline(body: string): string {
  return body.replace(/\n$/, "");
}

// One highlighter per process, loaded lazily and only for the languages asked for.
//
// Shiki's warm-up is ~90 ms and its grammars are large; constructing one per request
// would put that on the create path for every paste. Cached as a promise rather than a
// resolved instance so two concurrent creates share one warm-up instead of racing into
// two.
let highlighterPromise: Promise<Highlighter> | null = null;
const loaded = new Set<string>();

async function get(): Promise<Highlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighter({
      themes: [
        createCssVariablesTheme({
          name: THEME_NAME,
          variablePrefix: "--shiki-",
        }),
      ],
      langs: [],
    });
  }
  return highlighterPromise;
}

/**
 * Highlight one body, or return null when the language has no grammar.
 *
 * Null rather than throwing, and rather than falling back to plaintext silently: an
 * absent render is a case the view page already answers (escaped `<pre>`), so an unknown
 * language degrades to the same path as an over-threshold body. Throwing here would roll
 * back a correctly saved paste, which is the exact failure stage 8 sits outside the
 * transaction to avoid.
 */
export async function highlight(
  body: string,
  language: string,
): Promise<string | null> {
  const lang = grammarFor(language);
  const highlighter = await get();

  if (!loaded.has(lang)) {
    try {
      await highlighter.loadLanguage(lang as never);
      loaded.add(lang);
    } catch {
      // An unrecognised grammar is attacker-reachable: `language` can come straight from
      // an API caller. It must not be able to fail a save.
      return null;
    }
  }

  return highlighter.codeToHtml(stripTrailingNewline(body), {
    lang,
    theme: THEME_NAME,
    transformers: [styleToClassTransformer],
    // Per-line ids only when the paste asks for them: always emitting them doubles the
    // node count of a large log for the majority who never link a line.
    structure: "classic",
  });
}
