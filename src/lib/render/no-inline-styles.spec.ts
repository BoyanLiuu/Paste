import { describe, expect, it } from "vitest";

import { RENDERS } from "@/lib/fixtures/renders.generated";

// Guards the CSP property §6.5 rests on, which the architecture described incorrectly.
//
// Shiki's CSS-variables theme was supposed to be what keeps the view page at
// `style-src 'self'`. It is not: it emits `style="color:var(--shiki-token-comment)"`,
// and an inline style **attribute** needs 'unsafe-inline' whether its value is a
// literal colour or a var(). 674 of them were in the stored renders.
//
// A transformer in scripts/render-fixtures.mts now moves every declaration to a
// generated class. This test is what stops that regressing, because the symptom of
// losing it is invisible: the page looks identical and the policy quietly has to be
// loosened to keep working.

describe("stored renders", () => {
  it("contain no inline style attributes", () => {
    const offenders = Object.entries(RENDERS)
      .filter(([, html]) => html.includes('style="'))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it("colour their tokens with generated classes instead", () => {
    // Guards the guard: a render pipeline that emitted no classes either would pass
    // the assertion above while shipping unhighlighted text.
    const html = Object.values(RENDERS)[0];
    expect(html).toMatch(/class="[^"]*\btk\d+\b/);
  });

  it("emit one line element per counted line", () => {
    // A body ending in a newline made Shiki add a trailing empty line, so a 40-line
    // paste carried 41 line elements — and #L41 existed in the DOM while the range
    // parser refused it as past the end.
    const html = RENDERS["7fK2mQxZ:1:paste"];
    expect(html.match(/class="line"/g)).toHaveLength(40);
  });
});
