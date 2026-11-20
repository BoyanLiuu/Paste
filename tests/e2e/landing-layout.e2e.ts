import { expect, test } from "@playwright/test";

import { SHOT_SIZES } from "../../src/lib/shot-sizes.generated";

// The landing page's layout, measured (ARCHITECTURE Appendix H).
//
// WHY MEASURED AND NOT EYEBALLED. Every other suite covering `/` passes while the page looks
// broken: `a11y.e2e.ts` runs axe, which does not consider a figure wrapping mid-number a
// violation, and `public-reads.e2e.ts` only asks whether the images loaded. The two defects
// below shipped inside a green suite and were found by someone looking at a screenshot.
//
// 1. The hero's figures column was `minmax(0,1fr)` beside a `minmax(0,61rem)` image track.
//    61rem is a 976px MAXIMUM the first track grows into, so at a 1024 content width it took
//    everything: `25.0 MB` broke across two lines at 1280 and the `<dt>` measured 0px wide at
//    1100 and below.
// 2. Four hand-written `width`/`height` pairs declared the screenshots' intrinsic sizes. A
//    layout fix changed one capture's shape and its pair did not follow, so that screenshot
//    rendered at 0.44x inside a reserved box of the wrong aspect. The sizes are generated now
//    and this asserts the page honours them.
//
// Runs in all three projects, so 1280 and 390 are covered as well as 1440-ish.

test.describe("the landing page's layout", () => {
  test("no figure wraps inside its own value", async ({ page }) => {
    await page.goto("/");
    const dts = page.locator("main dl dt");
    await expect(dts.first()).toBeVisible();

    const broken = await dts.evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const el = node as HTMLElement;
          const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
          const lines = Math.round(
            el.getBoundingClientRect().height / lineHeight,
          );
          return {
            text: el.textContent ?? "",
            lines,
            width: Math.round(el.getBoundingClientRect().width),
          };
        })
        .filter((m) => m.lines > 1 || m.width === 0),
    );

    // A number split across two lines, or a track squeezed to nothing, is the most visible
    // way this page can look unfinished — and 1024–1280 is a laptop, not an edge case.
    expect(
      broken,
      `figures that wrap or have no width: ${JSON.stringify(broken)}`,
    ).toEqual([]);
  });

  test("no screenshot renders wider than it was captured", async ({ page }) => {
    await page.goto("/");
    const imgs = page.locator("main figure img");
    await expect(imgs.first()).toBeVisible();

    const measured = await imgs.evaluateAll((nodes) =>
      nodes.map((node) => {
        const img = node as HTMLImageElement;
        return {
          src: decodeURIComponent(img.currentSrc || img.src),
          rendered: Math.round(img.getBoundingClientRect().width),
        };
      }),
    );

    expect(measured).toHaveLength(Object.keys(SHOT_SIZES).length);

    for (const { src, rendered } of measured) {
      const name = (
        Object.keys(SHOT_SIZES) as (keyof typeof SHOT_SIZES)[]
      ).find((key) => src.includes(SHOT_SIZES[key].file));
      expect(name, `no manifest entry matches ${src}`).toBeDefined();

      // The captures are 2x, so half the intrinsic width is the CSS size they were taken
      // at. Upscaling past it is what made three sections look like three products.
      const captured = SHOT_SIZES[name!].width / 2;
      expect(
        rendered,
        `${name} renders ${rendered}px against a ${captured}px capture`,
      ).toBeLessThanOrEqual(captured + 1);
    }
  });
});
