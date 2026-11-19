import { expect, test } from "@playwright/test";

// The sample links on the create page (ux-01 – ux-12).
//
// WHAT BROKE, and why nothing caught it. `/?sample=python` is the SAME ROUTE, so clicking a
// sample link is a client-side navigation: the server component re-runs and sends a new
// `initialBody`, React reconciles `CreateForm` in place rather than remounting it, and
// react-hook-form reads `defaultValues` only on its first render. So the URL changed, the
// prop changed, and the textarea stayed empty.
//
// Every layer was individually correct. The server resolved the right sample, the prop
// arrived, the form rendered. The defect lived in the seam between a server component that
// re-runs per request and a client component that initialises once — which no unit test of
// either side can see, and which a developer typing into the box by hand never notices.
//
// The samples are not decoration: they are how every designed state on this page is
// reachable without typing the right thing, including the tier-1 block and the 27.5 MB
// oversize case. Silently empty samples take the whole demo path with them.
//
// EVERY ASSERTION HERE RETRIES, and the first version of this file did not — it read
// `inputValue()` once, immediately after the click, and three tests failed against a fixed
// app. react-hook-form sets the field's value from the ref after mount, so the
// server-rendered textarea is genuinely empty until hydration finishes. A single read is a
// race with hydration; `expect(locator).toHaveValue()` polls until it settles or times out.

test.describe("the sample links", () => {
  test("clean Python fills the textarea", async ({ page }) => {
    await page.goto("/");
    const body = page.getByLabel("Text");
    await expect(body).toHaveValue("");

    // CLICKED, not navigated to. Arriving at /?sample=python directly mounts the form once
    // with the right default and passes either way — it is the in-page click that
    // reproduces the bug, because it is the one that does not remount.
    await page.getByRole("link", { name: "clean Python" }).click();

    await expect(body).toHaveValue(/def /);
  });

  test("every sample link puts its text in the box", async ({ page }) => {
    // All of them, because each one is a different designed state and they are wired
    // through the same seam — one working says nothing about the others. The oversize
    // sample is excluded: it is 27.5 MB and asserting its contents would make this test a
    // load generator rather than a check.
    for (const name of ["clean Python", "a log", "an AWS key", "a password"]) {
      await page.goto("/");
      await page.getByRole("link", { name }).click();

      await expect(
        page.getByLabel("Text"),
        `${name} left the textarea empty`,
      ).toHaveValue(/[\s\S]{20,}/);
    }
  });

  test("the hero's sample link works too", async ({ page }) => {
    // A second entry point, with a fragment on it: `/?sample=python#new`. MEASURED: this
    // one passed both with and without the fix, so it is not what catches the regression —
    // the fragment makes Next treat it differently from the footer links and the form
    // remounts either way. Kept because it is a distinct path to the same state, and
    // labelled so nobody reads it as the guard. The footer-link tests above are the guard.
    await page.goto("/");
    await page.getByRole("link", { name: "Open a sample paste" }).click();

    await expect(page.getByLabel("Text")).toHaveValue(/def /);
  });

  test("arriving at a sample URL directly also fills it", async ({ page }) => {
    // The case that always worked, kept so a future fix that breaks the direct load
    // while fixing the click does not look green.
    await page.goto("/?sample=log");
    await expect(page.getByLabel("Text")).toHaveValue(/[\s\S]{20,}/);
  });
});
