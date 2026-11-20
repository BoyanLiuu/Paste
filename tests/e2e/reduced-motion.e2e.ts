import { expect, test } from "@playwright/test";

import { cleanUpSeeded, seed } from "./fixture";

// An animation that never settles (ARCHITECTURE Appendix E, M12).
//
// Appendix E's closing promise is that every animation is reduced to opacity-only or omitted
// under `prefers-reduced-motion: reduce`, with "one media query for the CSS ones". That
// media query did not exist when this file was written — there was a single narrow rule for
// the line highlight — so `animate-pulse` on five loading skeletons kept pulsing and every
// `transition-*` utility kept running. A pulsing placeholder is the canonical trigger for
// vestibular discomfort, and the skeletons are on the create page, the view page, the list,
// the moderation queue and the removal form.
//
// WHAT IS ASSERTED is the computed duration, not a screenshot. A visual comparison of an
// animated element is a race with its own keyframes: it passes or fails depending on which
// frame the screenshot caught, which is how a motion test becomes the flaky one everybody
// reruns. `getComputedStyle` is deterministic and says the thing that actually matters.
//
// EMULATED AT THE BROWSER LEVEL, not by injecting a class. `emulateMedia` makes the real
// media query match, so what runs is the same CSS a person with the OS setting enabled
// gets — including anything a library ships its own query for.

test.afterAll(cleanUpSeeded);

test.use({ reducedMotion: "reduce" });

/** Every element's animation and transition duration, in milliseconds. */
async function longestMotion(
  page: import("@playwright/test").Page,
): Promise<{ worst: number; where: string }> {
  return page.evaluate(() => {
    const ms = (value: string): number =>
      value
        .split(",")
        .map((v) => v.trim())
        .reduce((max, v) => {
          const n = v.endsWith("ms")
            ? Number.parseFloat(v)
            : Number.parseFloat(v) * 1000;
          return Number.isFinite(n) ? Math.max(max, n) : max;
        }, 0);

    let worst = 0;
    let where = "(nothing animated)";

    for (const element of document.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      const duration = Math.max(
        ms(style.animationDuration),
        ms(style.transitionDuration),
      );
      if (duration > worst) {
        worst = duration;
        where = `${element.tagName.toLowerCase()}.${element.className}`;
      }
    }
    return { worst, where };
  });
}

/** 1 ms, which is "the stylesheet collapsed it" rather than "it is slightly fast". */
const SETTLED_MS = 1;

/** A CSS duration as a number. `getComputedStyle` may return `2s`, `150ms` or `1e-05s`. */
function seconds(value: string): number {
  const n = value.endsWith("ms")
    ? Number.parseFloat(value) / 1000
    : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

test.describe("with prefers-reduced-motion: reduce", () => {
  test("the create page settles, skeletons included", async ({ page }) => {
    await page.goto("/new");

    const { worst, where } = await longestMotion(page);
    expect(worst, `still animating: ${where}`).toBeLessThanOrEqual(SETTLED_MS);
  });

  test("the view page settles", async ({ page }) => {
    const { id } = await seed({
      body: "def retry(fn):\n    return fn()\n",
      title: "a motion test",
    });
    await page.goto(`/p/${id}`);
    await page.locator("#paste-body").waitFor();

    const { worst, where } = await longestMotion(page);
    expect(worst, `still animating: ${where}`).toBeLessThanOrEqual(SETTLED_MS);
  });

  test("the tombstone settles, and never animated anyway", async ({ page }) => {
    // Appendix E: the 410 page animates NOTHING, in either mode. "Its job is to be believed
    // by someone reading a two-year-old ticket. Nothing on it should look generated."
    const { id } = await seed({ expiresInMinutes: -60 });
    await page.goto(`/p/${id}`);
    await expect(page.getByText(/410 Gone/)).toBeVisible();

    const { worst, where } = await longestMotion(page);
    expect(worst, `still animating: ${where}`).toBeLessThanOrEqual(SETTLED_MS);
  });

  test("the list page settles", async ({ page }) => {
    const { owner } = await seed({ title: "a listed paste" });
    await page.goto(`/list/${owner}`);

    const { worst, where } = await longestMotion(page);
    expect(worst, `still animating: ${where}`).toBeLessThanOrEqual(SETTLED_MS);
  });

  test("a loading skeleton is not pulsing", async ({ page }) => {
    // The skeleton specifically, caught mid-stream. Every assertion above samples a page
    // that has finished loading, and the skeleton is exactly the element that is gone by
    // then — so without this the thing most likely to be animating is the thing least
    // likely to be measured.
    const { id } = await seed({ body: "x = 1\n" });

    // Hold the response so the fallback is on screen when it is sampled.
    await page.route(`**/p/${id}`, async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.continue();
    });

    await page.goto(`/p/${id}`, { waitUntil: "commit" });
    const skeleton = page.locator('[role="status"]').first();
    await skeleton.waitFor({ timeout: 10_000 });

    const style = await skeleton.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        duration: computed.animationDuration,
        name: computed.animationName,
      };
    });

    // PARSED, NOT MATCHED. The first version asserted the string `0.01ms` and failed
    // against `1e-05s` — the browser's own serialisation of the same value. A test of a
    // numeric property that compares formatted text is testing the formatter.
    expect(seconds(style.duration)).toBeLessThanOrEqual(SETTLED_MS / 1000);

    // And the animation NAME survives, which is correct: the rule neutralises the motion
    // rather than removing the class, so nothing about the markup changes and the
    // skeleton still looks like a skeleton.
    expect(style.name).not.toBe("none");
  });
});

test.describe("without the preference", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the skeleton does animate, so the rule above is doing something", async ({
    page,
  }) => {
    // GUARDS THE GUARD. Every assertion in this file passes trivially if the app animates
    // nothing at all — and an app that animates nothing would also pass Appendix E's intent
    // while quietly having lost the four animations that carry information. This proves the
    // reduction is a reduction.
    const { id } = await seed({ body: "x = 1\n" });

    await page.route(`**/p/${id}`, async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.continue();
    });

    await page.goto(`/p/${id}`, { waitUntil: "commit" });
    const skeleton = page.locator('[role="status"]').first();
    await skeleton.waitFor({ timeout: 10_000 });

    const animation = await skeleton.evaluate(
      (el) => getComputedStyle(el).animationDuration,
    );
    // A real, visible duration — `animate-pulse` is 2s.
    expect(seconds(animation)).toBeGreaterThan(0.1);
  });
});
