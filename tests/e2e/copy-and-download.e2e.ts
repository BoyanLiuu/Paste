import { expect, test } from "@playwright/test";

import { cleanUpSeeded, seed } from "./fixture";

// The flow the product exists for: A pastes, B opens the link, B views, copies, downloads.
//
// WHY THIS IS A TEST AND NOT AN ASSUMPTION. The copy button reads the body out of the DOM,
// and the line numbers are right there in the gutter beside the text. They are a CSS
// counter written with `::before`, so `innerText` leaves them out — but that is a property
// of how the gutter happens to be implemented, not something the copy button declares. A
// future change that renders numbers as real elements for any reason (selectable numbers,
// a copy-with-numbers option, a table layout) breaks the clipboard silently: the button
// still works, the copy still happens, and what lands in the reader's editor is
//
//   1 def retry(fn):
//   2     return fn()
//
// which does not run. ARCHITECTURE §6.2 calls this the most common bug in the category, and
// it was the stated reason the copy button was supposed to fetch the bytes cross-origin.
// Asserting the clipboard is what makes the cheaper implementation safe to keep.
//
// Clipboard access needs a permission, granted per context below.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.afterAll(cleanUpSeeded);

const BODY = "def retry(fn):\n    return fn()\n";

test.describe("the share flow", () => {
  test("B opens A's link and reads the paste", async ({ page }) => {
    const { id } = await seed({ body: BODY, title: "retry helper" });

    // B arrives signed out, from a link. No session, no sign-in wall.
    const response = await page.goto(`/p/${id}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText("def retry")).toBeVisible();
  });

  test("B copies the body, and gets no line numbers", async ({ page }) => {
    const { id } = await seed({ body: BODY, title: "retry helper" });
    await page.goto(`/p/${id}`);
    await page.locator("#paste-body").waitFor();

    // `exact`, because "Copy" is a substring of "Copy link" and Playwright's default
    // accessible-name match is a substring one — so without it this resolves to both
    // buttons and fails on strict mode rather than on anything about the app.
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    // The label confirms, which is the only feedback a clipboard write produces.
    await expect(
      page.getByRole("button", { name: "Copied", exact: true }),
    ).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());

    // THE CONTENT IS THERE…
    expect(clipboard).toContain("def retry(fn):");
    expect(clipboard).toContain("return fn()");
    // …AND THE GUTTER IS NOT. No line reads "1 def retry" — which is what a DOM copy
    // produces the moment the numbers become real text.
    expect(clipboard).not.toMatch(/^\s*\d+\s*def retry/m);
    for (const line of clipboard.split("\n")) {
      expect(line, `a line began with its own number: ${line}`).not.toMatch(
        /^\s*\d+\s/,
      );
    }
  });

  test("B copies the link, and it is the permalink", async ({ page }) => {
    const { id } = await seed({ body: BODY });
    await page.goto(`/p/${id}`);

    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Link copied", exact: true }),
    ).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // The id, because that is the part that has to keep answering (§6.3). Not the title,
    // not a query string.
    expect(clipboard).toContain(`/p/${id}`);
  });

  test("B downloads the paste and gets the bytes", async ({ page }) => {
    const { id, body } = await seed({ body: BODY });
    await page.goto(`/p/${id}`);

    // The documented pattern: subscribe BEFORE the click. A download that starts before
    // the listener is attached is missed, and the first version of this raced
    // `waitForEvent` against a click-then-wait, which worked and read like a puzzle.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download" }).click();
    const download = await downloadPromise;

    // A real download, not a navigation — which is the security property as much as the
    // feature: `Content-Disposition: attachment` is what keeps hostile bytes from being
    // rendered as a page on this origin.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe(body);
  });
});
