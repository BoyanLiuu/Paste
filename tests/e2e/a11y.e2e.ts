import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { cleanUpSeeded, seed } from "./fixture";

// Keyboard traps and unlabelled controls on the four main screens (M12).
//
// WHAT AXE CAN AND CANNOT DO, stated up front because an accessibility suite that implies
// more than it checks is worse than none. Axe finds the mechanical failures: contrast below
// the ratio, a control with no accessible name, a heading level skipped, an `aria-*`
// attribute on an element that does not take it. It cannot tell whether the page makes
// sense to someone using it, and it does not check focus order at all.
//
// So the keyboard assertions below are written by hand. They are the half that matters most
// here: this product's primary surface is a text area and a page of monospace output, and
// the most likely real failure is a focus trap in the line-number gutter or a drag-select
// listener that swallows Tab.
//
// THE FOUR SCREENS ARE THE PLAN'S LIST — create, view, list, moderation. Moderation answers
// 404 to a signed-out visitor by design (§6.3), so what is asserted there is that the
// NOT-FOUND page is itself accessible, which is a page real users reach by mistyping a URL
// and is otherwise tested by nobody.

test.afterAll(cleanUpSeeded);

/**
 * Axe over one page, failing with the rule and the element rather than a count.
 *
 * `withTags` pins the standard: WCAG 2.1 AA, which is what "accessible" has to mean to be
 * checkable. Without it axe also reports best-practice rules, and a suite that fails on
 * best practices gets its expectations loosened within a week.
 */
async function scan(page: import("@playwright/test").Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));

  expect(
    violations,
    `${label}:\n${JSON.stringify(violations, null, 2)}`,
  ).toEqual([]);
}

test.describe("accessibility", () => {
  test("the create form", async ({ page }) => {
    await page.goto("/");
    await scan(page, "the create form");
  });

  test("the view page", async ({ page }) => {
    // Line numbers ON, because that is the surface with the gutter and the selection
    // listener — the one place a keyboard trap could plausibly live.
    const { id } = await seed({
      body: "def retry(fn):\n    return fn()\n\nretry(lambda: 1)\n",
      title: "retry helper",
    });
    await page.goto(`/p/${id}`);
    await scan(page, "the view page");
  });

  test("the tombstone", async ({ page }) => {
    // A 410 is a page people read, not an error to be swept past: §6.3's whole argument is
    // that someone finds this URL in a two-year-old ticket and has to understand it.
    const { id } = await seed({ expiresInMinutes: -60 });
    await page.goto(`/p/${id}`);
    await scan(page, "the tombstone");
  });

  test("someone's list of pastes", async ({ page }) => {
    const { owner } = await seed({ title: "a listed paste" });
    await page.goto(`/list/${owner}`);
    await scan(page, "the list page");
  });

  test("the removal request form", async ({ page }) => {
    // The one form with a radio group and a select, which is where unlabelled controls
    // actually happen — a `<legend>` missing from a fieldset is invisible on screen.
    const { id } = await seed({ title: "a paste to report" });
    await page.goto(`/p/${id}/request-removal`);
    await scan(page, "the removal request form");
  });

  test("the not-found page a mistyped URL reaches", async ({ page }) => {
    const response = await page.goto("/p/zzzzzzzz");
    expect(response?.status()).toBe(404);
    await scan(page, "the 404 page");
  });
});

test.describe("keyboard", () => {
  test("the view page can be traversed without a trap", async ({ page }) => {
    const { id } = await seed({
      body: "one\ntwo\nthree\nfour\n",
      title: "a keyboard test",
    });
    await page.goto(`/p/${id}`);
    // The body streams in too — see the note in the create-form test below.
    await page.locator("#paste-body").waitFor();

    // Tab through and record where focus lands. A TRAP IS A REPEATED ELEMENT: focus
    // returning to something it already visited while earlier elements are still ahead of
    // it. The gutter is the suspect — it renders an `<a>` per line, so a 500-line paste is
    // 500 tab stops, and the selection listener runs on the same element.
    const seen: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null || el === document.body) return "body";
        return `${el.tagName.toLowerCase()}#${el.id}.${el.className}[${el.getAttribute("href") ?? ""}]`;
      });
      seen.push(where);
    }

    // Focus moved at all. A page where Tab does nothing is the other failure, and it looks
    // identical to a page with no interactive content.
    expect(new Set(seen).size, `focus never moved: ${seen[0]}`).toBeGreaterThan(
      1,
    );

    // And it did not cycle back early. Three consecutive repeats of one target is a trap;
    // reaching the end of the document and wrapping to `body` is not.
    for (let i = 2; i < seen.length; i += 1) {
      const stuck = seen[i] === seen[i - 1] && seen[i] === seen[i - 2];
      expect(stuck, `focus stuck on ${seen[i]} at step ${i}`).toBe(false);
    }
  });

  test("the create form reaches its submit button by keyboard", async ({
    page,
  }) => {
    await page.goto("/");

    // WAIT FOR THE STREAMED FORM FIRST. The form is inside a Suspense boundary, so
    // `goto` resolves against the shell and the first version of this test spent all forty
    // Tab presses on a skeleton — then reported the submit button as unreachable by
    // keyboard. A test of focus order has to wait for the thing whose order it is testing,
    // and PPR makes "the page loaded" and "the controls exist" two different events.
    await page.getByRole("button", { name: "Save" }).waitFor();

    // The one thing that must be reachable without a mouse on the primary screen. Asserted
    // by tabbing rather than by counting focusables, because the failure is order — a
    // submit button before the textarea in the DOM is reachable and useless.
    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (el === null) return false;
        const text = (el.textContent ?? "").toLowerCase();
        return el.tagName === "BUTTON" && /save|create|paste/.test(text);
      });
    }
    expect(reached, "the submit button is not reachable by keyboard").toBe(
      true,
    );
  });
});
