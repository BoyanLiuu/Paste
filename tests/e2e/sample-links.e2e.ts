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

  test("New paste clears a loaded sample", async ({ page }) => {
    // BOTH CONTROLS, because they were two different links and only one worked. The nav
    // link points at `/`, which is a real navigation and remounts the form. The hero
    // button pointed at a bare `#new` — a same-page jump that scrolled to the form and
    // left the sample sitting in it, so "New paste" handed you somebody else's text.
    const body = page.getByLabel("Text");

    // The nav link and the hero button share an accessible name, so they are taken by
    // position: 0 is the nav, 1 is the hero. Measured — with the fix reverted, 0 passes and
    // 1 fails, which is the whole point of covering both.
    for (const [index, which] of [
      [0, "the nav link"],
      [1, "the hero button"],
    ] as const) {
      await page.goto("/?sample=python");
      await expect(body).toHaveValue(/def /);

      await page
        .getByRole("link", { name: "New paste", exact: true })
        .nth(index)
        .click();
      await expect(
        body,
        `"New paste" (${which}) left the sample in the box`,
      ).toHaveValue("");
    }
  });

  test("New paste also clears the title", async ({ page }) => {
    // The sample sets a title too, and a stale title on an empty body is the more
    // confusing half: the page looks new and the paste is named `retry_backoff.py`.
    await page.goto("/?sample=python");
    await expect(page.getByLabel("Title (optional)")).toHaveValue(
      "retry_backoff.py",
    );

    await page
      .getByRole("link", { name: "New paste", exact: true })
      .nth(1)
      .click();
    await expect(page.getByLabel("Title (optional)")).toHaveValue("");
  });

  test("the textarea keeps its height and scrolls itself", async ({ page }) => {
    // THE SHADCN BASE CLASS GROWS THE CONTROL. `field-sizing-content` is on the shared
    // Textarea, so `rows={16}` was ignored and a 40-line sample stretched the box until the
    // PAGE scrolled — which pushed the expiry panel off screen. That panel is what §6.3
    // wants read before saving, so the growth buried the one thing the screen exists to
    // surface.
    //
    // Asserted on the measured box rather than on a class name, because the failure is a
    // layout one: a future change could drop `field-sizing-fixed` and a class assertion
    // would catch it, while a different change could set an explicit height that goes stale
    // against the font and only this check would notice.
    await page.goto("/");
    const body = page.getByLabel("Text");
    await expect(body).toHaveValue("");

    // LAID OUT BEFORE MEASURED. `toHaveValue` waits for the value, not for layout, and this
    // measured 0 — passing when the file ran alone and failing under the full suite, which
    // is slower. `clientHeight`, not `boundingBox()`, which returned null here and is the
    // wrong quantity anyway: the inner box height is what "fixed height" means.
    //
    // The third timing race in this file, all the same shape. On a streamed page every
    // measurement needs its own wait, because "the document loaded" says nothing about
    // whether the thing being measured exists yet.
    const height = () => body.evaluate((el) => el.clientHeight);
    await expect.poll(height).toBeGreaterThan(50);
    const empty = await height();

    await page.goto("/?sample=python");
    await expect(body).toHaveValue(/def /);
    await expect.poll(height).toBeGreaterThan(50);
    const filled = await height();

    // SAME HEIGHT, 40 lines of content later.
    expect(filled).toBeCloseTo(empty, 0);

    // AND THE CONTENT IS REACHABLE: the box scrolls internally rather than being clipped.
    const scrolls = await body.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1,
    );
    expect(scrolls, "the sample fits the box, so this proves nothing").toBe(
      true,
    );
  });

  test("the save receipt replaces the form AND its heading", async ({
    page,
  }) => {
    // THE SAVED STATE IS `?saved=<id>` ON THE URL, which is what makes both halves of this
    // possible. While it was state inside the form, this page's heading could not see it
    // and sat above the receipt saying "Pick how long it lives now. There is no delete
    // button later." — instructions for a paste that was already saved with a retention
    // already chosen.
    //
    // SKIPPED SIGNED OUT, and that is the honest state of it. The panel now renders only
    // for a paste the VIEWER OWNS — which is the fix for the forged receipt below — so it
    // cannot be reached without a Clerk session, and there is no test credential. The
    // assertions are kept rather than deleted so the next person with a session can run
    // them, and `create-receipt.tsx` carries the same note.
    test.skip(true, "needs a signed-in session to own a paste");
    await page.goto("/?saved=5CEXkh7Z");

    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
    await expect(page.getByText("Pick how long it lives now")).toHaveCount(0);
    await expect(page.getByLabel("Text")).toHaveCount(0);

    // The link, absolute, and the actions.
    await expect(page.getByText(/\/p\/5CEXkh7Z$/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View paste" }),
    ).toHaveAttribute("href", "/p/5CEXkh7Z");
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  });

  test("every New paste control escapes the receipt", async ({ page }) => {
    // THE SECOND DEFECT, and the one that is invisible without clicking. "New paste" in the
    // hero and in the nav are links to `/#new` and `/` — and from `/` neither is a
    // navigation, so with the receipt held in form state they updated the address bar and
    // left it on screen. From `?saved=` they all lead away from a different URL.
    //
    // Both are checked by position: 0 is the nav, 1 the hero. The receipt used to carry a
    // third copy and no longer does — two permanent controls that do the same thing made
    // the one inside the card redundant, and it competed with the two actions that are
    // specific to having just saved something.
    for (const [index, which] of [
      [0, "the nav link"],
      [1, "the hero button"],
    ] as const) {
      test.skip(true, "needs a signed-in session to own a paste");
      await page.goto("/?saved=5CEXkh7Z");
      await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();

      await page
        .getByRole("link", { name: "New paste", exact: true })
        .nth(index)
        .click();

      await expect(
        page.getByLabel("Text"),
        `"New paste" (${which}) did not return to the form`,
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Saved" })).toHaveCount(0);
    }
  });

  test("a saved id the viewer did not save shows the form, not a receipt", async ({
    page,
  }) => {
    // A FORGED RECEIPT IS THE FAILURE HERE, and the first version of this page allowed it:
    // `isPasteId` only says the string LOOKS like an id, so each of these rendered a
    // complete "Saved." panel — one for a paste that never existed, with a "View paste"
    // button answering 404, and one claiming the viewer had saved somebody else's paste.
    //
    // It is the same thing §6.3 refuses for tombstones, from the other end: an unknown id
    // answers 404 rather than 410 precisely so nobody can mint a plausible screenshot.
    //
    // These run signed out, which is also the first condition the check applies: saving
    // needs a session, so a signed-out visitor cannot have saved anything.
    for (const id of [
      "not-an-id", // wrong shape
      "zzzzzzzz", // right shape, no such paste
      "SCnZoSWi", // right shape, a real paste, not the viewer's
    ]) {
      await page.goto(`/?saved=${id}`);
      await expect(
        page.getByLabel("Text"),
        `?saved=${id} did not fall back to the form`,
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Saved" }),
        `?saved=${id} rendered a forged receipt`,
      ).toHaveCount(0);
    }
  });
});
