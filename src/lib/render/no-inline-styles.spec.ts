import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RENDERS } from "@/lib/fixtures/renders.generated";
import { allTokenClasses } from "@/lib/render/tokens";

// Guards the CSP property §6.5 rests on, which the architecture described incorrectly.
//
// Shiki's CSS-variables theme was supposed to be what keeps the view page at
// `style-src 'self'`. It is not: it emits `style="color:var(--shiki-token-comment)"`,
// and an inline style **attribute** needs 'unsafe-inline' whether its value is a
// literal colour or a var(). 674 of them were in the stored renders.
//
// A transformer in src/lib/render/highlight.ts now moves every declaration to a class
// from the shared vocabulary. This test is what stops that regressing, because the
// symptom of losing it is invisible: the page looks identical and the policy quietly has
// to be loosened to keep working.

describe("stored renders", () => {
  it("contain no inline style attributes", () => {
    const offenders = Object.entries(RENDERS)
      .filter(([, html]) => html.includes('style="'))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("colour their tokens with classes instead", () => {
    // Guards the guard: a render pipeline that emitted no classes either would pass the
    // assertion above while shipping unhighlighted text.
    const html = Object.values(RENDERS)[0];
    expect(html).toMatch(/class="[^"]*\btk-[a-z-]+\b/);
  });

  it("use only classes the generated stylesheet defines", () => {
    // The failure this catches arrives with M7, when a second renderer writes
    // `paste_renders` at save time. Class names used to be allocated by insertion order
    // (`tk0`, `tk1`, …), which is only coherent while one process renders everything and
    // writes the stylesheet in the same pass. Two processes would assign the same name to
    // different colours, and every individual render would still look internally
    // consistent — so nothing would point at the cause.
    const defined = new Set(allTokenClasses());
    const used = new Set<string>();
    for (const html of Object.values(RENDERS)) {
      for (const match of html.matchAll(/class="([^"]*)"/g)) {
        for (const name of match[1].split(/\s+/)) {
          if (name.startsWith("tk-")) used.add(name);
        }
      }
    }

    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("defines a rule for every variable the theme can emit", () => {
    // The stylesheet is generated from the vocabulary rather than from what the current
    // fixtures reached, so a paste that first produces a `link` token is already styled.
    // Generating only encountered declarations is how an unstyled token ships later.
    const css = readFileSync(
      join(import.meta.dirname, "../../app/shiki-tokens.generated.css"),
      "utf8",
    );
    for (const name of allTokenClasses()) {
      expect(css, name).toContain(`.${name} {`);
    }
  });

  it("emit one line element per counted line", () => {
    // A body ending in a newline made Shiki add a trailing empty line, so a 40-line
    // paste carried 41 line elements — and #L41 existed in the DOM while the range
    // parser refused it as past the end.
    const html = RENDERS["7fK2mQxZ:1:paste"];
    expect(html.match(/class="line"/g)).toHaveLength(40);
  });
});
