// The token class vocabulary shared by every renderer (ARCHITECTURE §6.5).
//
// Shiki's CSS-variables theme still emits `style="color:var(--shiki-token-X)"` on every
// span — an inline style *attribute*, which would force `style-src 'unsafe-inline'` on
// the one page that renders hostile text. A transformer moves each declaration to a
// class and this module owns the naming.
//
// THE NAME IS DERIVED FROM THE DECLARATION, never from the order it was first seen.
//
// That is the whole point of this file. The fixture script used to allocate `tk0`, `tk1`,
// … as it encountered declarations, which worked only because one process rendered
// everything and wrote the stylesheet in the same pass. From M7 a second renderer writes
// `paste_renders` at save time, and an order-dependent name means the two processes agree
// only by luck: the same `tk3` would mean "foreground" in one render and "punctuation" in
// another, against a single committed stylesheet. Stored HTML would be miscoloured with
// nothing to point at, because every individual render is internally consistent.

/**
 * Every CSS variable `createCssVariablesTheme` can emit, not only the ones the current
 * fixtures happen to reach.
 *
 * The stylesheet is generated from this list rather than from what was rendered, so a
 * language that first produces a `link` token has a rule waiting for it. Generating only
 * encountered declarations is how you ship an unstyled token six months later.
 */
export const TOKEN_VARIABLES = [
  "constant",
  "string",
  "comment",
  "keyword",
  "parameter",
  "function",
  "string-expression",
  "punctuation",
  "link",
] as const;

/** The `<pre>` wrapper's own declaration, which sets both colours at once. */
export const PRE_CLASS = "tk-pre";

const PRE_DECLARATION =
  "background-color:var(--shiki-background);color:var(--shiki-foreground)";

/**
 * The class for one inline style declaration.
 *
 * Throws on anything unrecognised rather than inventing a name. A silent fallback here
 * reintroduces exactly the bug this module exists to prevent — an unknown declaration
 * would get *some* class, the stylesheet would not have it, and the token would render in
 * the inherited colour on a page nobody re-checks.
 */
export function classForDeclaration(declaration: string): string {
  const normalised = declaration.trim().replace(/;$/, "");
  if (normalised === PRE_DECLARATION) return PRE_CLASS;

  // `color:var(--shiki-foreground)` — plain body text, distinct from the pre wrapper.
  if (normalised === "color:var(--shiki-foreground)") return "tk-foreground";

  const match = /^color:var\(--shiki-token-([a-z-]+)\)$/.exec(normalised);
  if (match !== null) {
    const name = match[1];
    if ((TOKEN_VARIABLES as readonly string[]).includes(name)) {
      return `tk-${name}`;
    }
    throw new Error(
      `Unknown Shiki token variable "--shiki-token-${name}". Add it to TOKEN_VARIABLES ` +
        `in src/lib/render/tokens.ts so the stylesheet carries a rule for it.`,
    );
  }

  throw new Error(
    `Unrecognised Shiki style declaration: ${JSON.stringify(declaration)}. ` +
      `src/lib/render/tokens.ts must name a class for it, or the token renders unstyled.`,
  );
}

/** Every class this vocabulary can produce, for the test that checks the stylesheet. */
export function allTokenClasses(): string[] {
  return [
    PRE_CLASS,
    "tk-foreground",
    ...TOKEN_VARIABLES.map((name) => `tk-${name}`),
  ];
}

/**
 * The stylesheet, generated from the vocabulary above.
 *
 * Written to `src/app/shiki-tokens.generated.css` rather than kept here as a string the
 * app imports: it has to be a real stylesheet for `style-src 'self'` to cover it.
 */
export function tokenStylesheet(): string {
  const rules = [
    `.${PRE_CLASS} { ${PRE_DECLARATION} }`,
    `.tk-foreground { color:var(--shiki-foreground) }`,
    ...TOKEN_VARIABLES.map(
      (name) => `.tk-${name} { color:var(--shiki-token-${name}) }`,
    ),
  ];

  return `/* GENERATED from src/lib/render/tokens.ts — do not edit. */
/* Token classes replacing Shiki's inline style attributes, so the view page's CSP can
   stay at \`style-src 'self'\` (ARCHITECTURE §6.5). The --shiki-* values themselves are
   defined in globals.css, from the prototype's palette.

   Class names are derived from the declaration, not from the order it was first seen, so
   the fixture script and the save-time renderer in M7 produce identical markup. Every
   variable the theme can emit has a rule here even if no current paste reaches it. */
${rules.join("\n")}
`;
}
