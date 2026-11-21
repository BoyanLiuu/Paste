import { expect, test } from "@playwright/test";

// The landing page's scroll reveal, measured rather than asserted by class name.
//
// WHAT THESE CATCH, because a scroll-driven animation has no state a normal test can read
// and every bug below shipped looking perfectly fine in a screenshot:
//
//   1. THE STAGGER RUNNING BACKWARDS. The first implementation used the anonymous `view()`
//      timeline, which measures each element's OWN box. A section's screenshot is ~500px
//      tall against ~200px of copy and `items-center` lifts the taller box, so the shot's
//      entry phase started FIRST and the intended order — sentence, then its evidence —
//      was inverted. Nothing but a measurement would have noticed.
//   2. THE REVEAL COLLAPSING INTO A SNAP. `--ease-out` is an exponential curve meant for a
//      120ms transition; against a scroll position it spent ~85% of its travel in the first
//      60px of scrolling, so the movement the user asked to be able to see was over before
//      it registered. This asserts the travel is spread across a distance a reader crosses.
//   3. A SECOND ANIMATION LEFT ON THE DOCUMENT CLOCK. `animation-timeline` is a list; name
//      it once against two animation names and the second runs on load — every section
//      revealing at once, including the ones four screens down.
//
// The numbers are deliberately loose. This is a guard against the effect being broken or
// inverted, not a pin on the curve — retuning the range should not turn it red.

type Track = { op: number; travel: number };

test.describe("landing page scroll reveal", () => {
  test("copy leads its screenshot, and the fade finishes before the slide", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.evaluate(() => document.fonts.ready);

    test.skip(
      !(await page.evaluate(() =>
        CSS.supports("animation-timeline", "view()"),
      )),
      "no scroll-driven animations in this browser; the @supports gate leaves content static",
    );

    const probe = async (y: number) =>
      page.evaluate(async (scrollY) => {
        window.scrollTo(0, scrollY);
        // TWO FRAMES. The compositor samples a scroll-driven animation on the next frame, so
        // a computed style read in the same task returns the PREVIOUS scroll position — which
        // made the first draft of this probe report a hard snap that was not there.
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );

        const section = document.querySelector(".reveal-section");
        if (section === null) throw new Error("no .reveal-section on the page");

        const read = (selector: string) => {
          const element = section.querySelector(selector);
          if (element === null)
            throw new Error(`no ${selector} in the section`);
          const style = getComputedStyle(element);
          return {
            op: Number(style.opacity),
            // Distance still to travel, as a fraction of the 4rem start offset, so a
            // left-entering track and a right-entering one compare directly.
            travel: Math.abs(new DOMMatrixReadOnly(style.transform).m41) / 64,
          };
        };

        return {
          copy: read(".reveal-left, .reveal-right"),
          shot: read(".reveal-shot"),
        };
      }, y);

    let moving = 0;
    let shotBehind = 0;
    let fadeAhead = 0;

    // The first feature section's entry phase at this viewport. Wide enough to contain it
    // whether or not the hero above changes height.
    for (let y = 560; y <= 1240; y += 40) {
      const { copy, shot }: { copy: Track; shot: Track } = await probe(y);

      if (copy.travel > 0.03 && copy.travel < 0.97) moving += 1;
      if (shot.travel - copy.travel > 0.05 || copy.op - shot.op > 0.05) {
        shotBehind += 1;
      }
      if (copy.op > 0.995 && copy.travel > 0.03) fadeAhead += 1;
    }

    // Bug 2: at 40px per sample, four samples is ~160px of scroll with visible movement.
    expect(moving).toBeGreaterThan(4);
    // Bug 1: the screenshot is behind its copy, never ahead of it.
    expect(shotBehind).toBeGreaterThan(3);
    // The split ranges: text reaches full contrast while it is still settling into place.
    expect(fadeAhead).toBeGreaterThan(1);
  });

  test("nothing has moved before the section is reached", async ({ page }) => {
    // Bug 3. At the top of the page the sections below are untouched — if a second
    // animation were on the document clock it would already have run to completion here.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("heading", { level: 1 }).waitFor();

    test.skip(
      !(await page.evaluate(() =>
        CSS.supports("animation-timeline", "view()"),
      )),
      "no scroll-driven animations in this browser",
    );

    const last = await page.evaluate(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const sections = document.querySelectorAll(".reveal-section");
      const copy = sections[sections.length - 1].querySelector(
        ".reveal-left, .reveal-right",
      );
      const style = getComputedStyle(copy as Element);
      return {
        op: Number(style.opacity),
        x: Math.abs(new DOMMatrixReadOnly(style.transform).m41),
      };
    });

    expect(last.op).toBeLessThan(0.05);
    expect(last.x).toBeGreaterThan(32);
  });

  test("reduced motion leaves every section visible and in place", async ({
    page,
  }) => {
    // The reveal is decoration: with motion suppressed the content must be fully readable
    // without scrolling past it, not stuck at opacity 0 — which is what a reveal gated only
    // on @supports and not on the media query would do.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("heading", { level: 1 }).waitFor();

    const tracks = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(".reveal-left, .reveal-right"),
        (element) => {
          const style = getComputedStyle(element);
          return {
            op: Number(style.opacity),
            x: Math.abs(new DOMMatrixReadOnly(style.transform).m41),
          };
        },
      ),
    );

    expect(tracks.length).toBeGreaterThan(3);
    for (const track of tracks) {
      expect(track.op).toBe(1);
      expect(track.x).toBeLessThan(1);
    }
  });
});
