import { expect, test } from "@playwright/test";

import { withDb } from "./fixture";

// Creating a paste without an account (ARCHITECTURE §3, M15).
//
// THE ENUMERATION LEAK IS WHY THIS IS AN E2E TEST. `/p/:id` once rendered an owner
// breadcrumb linking to `/list/:username`, and `listPastes` filtered on the username with no
// visibility check — both public. So anyone holding ONE anonymous paste link could list every
// other paste that guest created: paste one benign thing and one sensitive thing anonymously,
// and either link exposes the other.
//
// Guarding it took three passes, and the first two LOOKED complete. The breadcrumb was
// guarded, then the metadata row — and the handle was still in the HTML, printed by the
// lifecycle timeline's "Saved as revision 1. By <username>". Unit tests on each component
// would have passed throughout. Only the rendered page shows whether the name is absent, so
// that is what this asserts.

/** Create a paste with no session, and return its id. */
async function createAnonymously(
  request: import("@playwright/test").APIRequestContext,
  body: string,
): Promise<string> {
  const response = await request.post("/api/pastes", {
    headers: { "Content-Type": "text/plain", Accept: "text/plain" },
    data: body,
  });

  expect(response.status(), await response.text()).toBe(201);
  const url = (await response.text()).trim();
  return url.split("/p/")[1];
}

/** Lapse a paste by moving its clock, the way a real expiry reads to `livenessOf`. */
async function expireNow(id: string): Promise<void> {
  await withDb(async (c) => {
    await c.query(
      `UPDATE paste.pastes
          SET expires_at = now() - interval '2 hours',
              purge_after = now() + interval '28 days',
              state = 'expired'
        WHERE id = $1`,
      [id],
    );
  });
}

test.describe("a signed-out visitor", () => {
  test("creates a paste and gets a link that needs no account to open", async ({
    page,
    request,
  }) => {
    // The whole feature in one assertion: no session on the way in, no session on the way
    // out, and the text comes back.
    const id = await createAnonymously(request, "created without an account\n");

    const response = await page.goto(`/p/${id}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("#paste-body")).toContainText(
      "created without an account",
    );
  });

  test("saves from the form and gets a receipt offering to claim it", async ({
    page,
  }) => {
    // THE FLOW A PERSON ACTUALLY USES, through the form rather than the API. Everything
    // else in this file posts to `/api/pastes` directly, which skips the two things most
    // likely to be wrong in a browser: that Save does not bounce a signed-out visitor to
    // sign-in, and that the receipt renders for a viewer whose identity is a cookie.
    //
    // `mayShowSavedReceipt` requires the paste to EXIST and BELONG TO THE VIEWER — written
    // against accounts in M12, and it has to hold for a guest resolved from a cookie or the
    // receipt silently falls back to an empty form after a successful save.
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/hydrat/i.test(text)) hydrationErrors.push(text.slice(0, 160));
    });

    await page.goto("/new");
    await page.getByLabel("Text").fill("saved from the form, no account\n");
    await page.getByRole("button", { name: "Save" }).click();

    // WAIT FOR THE NAVIGATION, not just for the element. Saving ends in a full load —
    // `create-form.tsx` records why a soft navigation cannot reach `?saved=` from this
    // route — so the default 5s element timeout was racing a page load plus two Suspense
    // boundaries, and failed against a working app.
    await page.waitForURL(/\/new\?saved=/, { timeout: 30_000 });

    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible({
      timeout: 15_000,
    });

    // The stale heading must be gone. It belongs to the form, and rendering it beside the
    // receipt told someone to "pick how long it lives now" for a paste already saved with
    // its retention fixed — a bug `create-form.tsx` documents as fixed, which the
    // landing-page split reintroduced by moving the heading onto the page unconditionally.
    await expect(page.getByText("Pick how long it lives now")).toHaveCount(0);

    // The copy must not claim the paste is unsaved. It is saved; signing in claims it.
    await expect(page.getByText("Saved without an account")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign in" }).first(),
    ).toBeVisible();

    // NO HYDRATION MISMATCH. The receipt derived its URL from `window.location.origin`
    // with a `""` fallback, so the server rendered `/p/<id>` and the client
    // `http://host/p/<id>` — React reported a recoverable hydration error every time the
    // receipt appeared. It survived because the receipt needed a session to reach until
    // M15, so neither suite could render it; the first person to use guest creation saw it.
    //
    // Asserted on the console rather than the markup, because a mismatch is a warning
    // React recovers from: the page looks right and the error is only in the log.
    expect(
      hydrationErrors,
      `React reported: ${hydrationErrors.join(" | ")}`,
    ).toEqual([]);

    // The URL is absolute, which is the whole point of the receipt — `/p/<id>` pasted into
    // a chat window is not a link.
    await expect(page.locator("p.break-all").first()).toContainText("http");

    // And the link it hands back resolves.
    const url = await page.locator("p.break-all").first().innerText();
    const id = url.trim().split("/p/")[1];
    expect(id).toMatch(/^[1-9A-HJ-NP-Za-km-z]{8}$/);

    const opened = await page.goto(`/p/${id}`);
    expect(opened?.status()).toBe(200);
    await expect(page.locator("#paste-body")).toContainText(
      "saved from the form, no account",
    );
  });

  test("leaves no guest handle anywhere in the page", async ({
    page,
    request,
  }) => {
    // THE ASSERTION THAT CAUGHT THE REAL BUG. `guest-038cd18166` is enough to construct
    // `/list/guest-038cd18166` by hand, so the handle appearing ANYWHERE defeats the
    // breadcrumb guard — it does not matter which component printed it.
    const id = await createAnonymously(request, "no handle in here please\n");
    await page.goto(`/p/${id}`);

    const html = await page.content();
    const handles = html.match(/guest-[0-9a-f]+/g) ?? [];
    expect(handles, `the page printed ${handles.join(", ")}`).toEqual([]);

    // And there is no list to reach, by any link on the page.
    const lists = html.match(/\/list\/[A-Za-z0-9_-]+/g) ?? [];
    expect(lists, `the page linked to ${lists.join(", ")}`).toEqual([]);
  });

  test("shows the owner as having no account, rather than blank", async ({
    page,
    request,
  }) => {
    // Withholding the handle must not read as missing data. A reader is entitled to know
    // the paste has no account behind it — that is a fact about its provenance, and the
    // product's voice is to say what happened.
    const id = await createAnonymously(request, "owner row check\n");
    await page.goto(`/p/${id}`);

    await expect(page.getByText("No account").first()).toBeVisible();
  });

  test("leaves no guest handle on the 410 receipt either", async ({
    page,
    request,
  }) => {
    // THE THIRD PLACE THIS LEAKED, and the one that survived two fixes I had already called
    // complete. The tombstone is a DIFFERENT COMPONENT from the view page, so guarding the
    // breadcrumb, the metadata row and the lifecycle timeline did nothing for it — and it
    // prints "<date> by <owner>" on the receipt.
    //
    // Reachable by anyone: create anonymously with an hour's retention and wait. Which is
    // why the display decision now lives in `lib/guest-handle.ts` rather than beside any
    // one component.
    const id = await createAnonymously(request, "tombstone handle check\n");

    // Lapse it rather than waiting an hour. The sweeper's own `state` write is not needed:
    // `livenessOf` recomputes expiry from the clock, which is what makes a 410 honest even
    // before the sweeper has run.
    await expireNow(id);

    const response = await page.goto(`/p/${id}`);
    expect(response?.status()).toBe(410);

    const html = await page.content();
    const handles = html.match(/guest-[0-9a-f]+/g) ?? [];
    expect(handles, `the receipt printed ${handles.join(", ")}`).toEqual([]);

    // And it still says whose it was, in the only way it truthfully can.
    await expect(page.getByText("No account")).toBeVisible();
  });

  test("the header never names a guest, on any page", async ({
    page,
    request,
  }) => {
    // THE FOURTH AND WORST PLACE THIS LEAKED, and the user found it by looking at the
    // screen. `AppShell` renders on EVERY route and asks "is there a user?" — which is true
    // of a guest by design — so it printed "Signed in as guest-839bbe818b | Sign out" above
    // every paste, publishing the exact handle the breadcrumb, the metadata row, the
    // timeline and the tombstone were all withholding.
    //
    // Checked on three routes rather than one, because the leak was in the CHROME: the bug
    // was invisible to every test that looked at a page's own content.
    const id = await createAnonymously(request, "header check\n");

    for (const path of ["/new", `/p/${id}`, "/"]) {
      await page.goto(path);
      const html = await page.content();

      const handles = html.match(/guest-[0-9a-f]+/g) ?? [];
      expect(handles, `${path} printed ${handles.join(", ")}`).toEqual([]);

      // And it offers sign-in rather than sign-out: there is no session to end, and the
      // cookie is this browser's only claim on its own pastes, so a control that clears it
      // offers to orphan them irreversibly.
      await expect(
        page.getByRole("link", { name: "Sign in" }).first(),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(
        0,
      );
      await expect(page.getByRole("link", { name: "My pastes" })).toHaveCount(
        0,
      );
    }
  });

  test("a guest's list is indistinguishable from a handle nobody has", async ({
    page,
  }) => {
    // NOT A 404, which is what the plan originally specified and would have been worse: a
    // 404 for guest handles and a 200 for unknown ones makes a guest DETECTABLE by probing.
    // Identical answers are the stronger property.
    await page.goto("/list/guest-0000000000");
    const guestPage = await page.content();

    await page.goto("/list/definitely-nobody-at-all");
    const unknownPage = await page.content();

    for (const html of [guestPage, unknownPage]) {
      expect(html).toContain("Nobody has saved anything under that name");
    }
  });
});
