import { expect, test } from "@playwright/test";

// The matcher mistake that breaks the premise (ARCHITECTURE §2, §3).
//
// Reads are public and writes require a session. That asymmetry is the product, not a
// default — and the way it dies is a middleware matcher that protects one route too many.
// Signed out, every read below must work; a redirect to /sign-in is the failure.
//
// AN END-TO-END TEST AND NOT A UNIT ONE, deliberately. What is under test is the
// composition: Clerk's middleware, the proxy's status rewrite, PPR's static shell and the
// CSP header all interact, and each has already produced a bug the others hid. Unit tests
// of `viewRoute` passed while the composed stack returned 500 for every 404 and 410 —
// twice, for different reasons, before this file existed.
//
// These run with NO SESSION. Playwright gives each test a fresh context, so signed out is
// the default rather than something to arrange.
//
// FIXTURES ARE SEEDED THROUGH THE DATABASE, not through the API. The first version of this
// file created them with `POST /api/pastes`, which stopped working the moment M10 wired
// Clerk: signed out, that endpoint now answers 401, correctly. The CLI and its Bearer token
// were dropped rather than deferred, so a browser session is the only way to create a
// paste — a property of the product, and the reason the harness inserts rows directly.

import { BASE58, cleanUpSeeded, seed } from "./fixture";

// The harness moved to `./fixture.ts` at M12, when two more suites needed the same four
// INSERTs and the same teardown.
test.afterAll(cleanUpSeeded);

test.describe("signed out", () => {
  test("the create form renders and offers sign-in", async ({ page }) => {
    const response = await page.goto("/new");
    expect(response?.status()).toBe(200);

    // NOT A REDIRECT, and this is the assertion rather than the status code. Bouncing a
    // visitor to a sign-in wall before they have typed anything is the opposite of the
    // product: the form renders signed out and the refusal happens on submit.
    expect(new URL(page.url()).pathname).toBe("/new");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Text")).toBeVisible();
  });

  test("the landing page renders signed out, with its screenshots", async ({
    page,
  }) => {
    // THE SURFACE A STRANGER MEETS FIRST, and it has to work with no session at all.
    // Asserted on the images because they are what this page's argument is made of: if
    // `public/shots/` is missing from the deploy, the page still renders every heading and
    // every claim with four broken boxes where the evidence was.
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/");

    // SELECTED BY STRUCTURE, NOT BY `src`. The first version matched
    // `img[src*="/shots/"]` and found zero elements on a page with four images:
    // `next/image` rewrites the attribute to `/_next/image?url=%2Fshots%2Fread.png&w=…`,
    // so the path is there but percent-encoded. Matching the figure is both stable
    // against that and the thing actually being asserted — a screenshot with a caption.
    const shots = page.locator("main figure img");
    await expect(shots).toHaveCount(4);

    // DECODED, not merely present. A 404 on the image still produces an `<img>` in the
    // DOM with a measurable box, so `toBeVisible` passes on a broken one — and on this
    // page a broken box is the whole argument missing.
    for (let i = 0; i < 4; i += 1) {
      const loaded = await shots
        .nth(i)
        .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
      expect(loaded, `screenshot ${i} did not load`).toBe(true);
    }
  });

  test("a live paste reads, with its content", async ({ page }) => {
    const { id, body } = await seed({
      body: "def greet(name):\n    return name\n",
    });
    expect(id).toMatch(BASE58);

    const response = await page.goto(`/p/${id}`);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(`/p/${id}`);

    // The body, not just a 200. A shell that renders with the content missing is the
    // failure PPR introduces, and it has happened here: a resolved Suspense boundary left
    // in a `display: none` div by a CSP that blocked React's relocation script.
    await expect(page.getByText("def greet")).toBeVisible();
    expect(body).toContain("def greet");
  });

  test("the download endpoint serves bytes", async ({ request }) => {
    const { id, body } = await seed({ body: "line one\nline two\n" });

    const download = await request.get(`/dl/${id}`);
    expect(download.status()).toBe(200);
    // Byte-for-byte, because this is what lands in the reader's file.
    expect(await download.text()).toBe(body);
    expect(download.headers()["content-disposition"]).toContain("attachment");
  });

  test("there is no inline byte endpoint", async ({ request }) => {
    const { id } = await seed({ body: "line one\n" });

    // `/raw/:id` SERVED THESE BYTES INLINE and is gone. That is the change that let the app
    // ship on one domain: inline bytes are one content-type mistake away from being a page,
    // and a page on the app's own origin runs with the reader's session — so §6.5 required a
    // second registrable domain to hold them. An attachment has no origin to execute in,
    // so there is nothing left to isolate.
    //
    // Asserted rather than assumed, because a route file is one `git revert` away from
    // coming back and nothing else in the suite would notice.
    expect((await request.get(`/raw/${id}`)).status()).toBe(404);
  });

  test("anyone's list page reads", async ({ page }) => {
    const { owner } = await seed({});

    // Anyone's list, not just one's own. The username comes from the URL because the page
    // is public, which is also what makes cross-tenant scoping easy to get wrong with a
    // single account — `ownership.spec.ts` covers that half.
    const response = await page.goto(`/list/${owner}`);
    expect(response?.status()).toBe(200);
  });

  test("an id that never existed is 404, not a tombstone", async ({ page }) => {
    // A 410 here would let anyone mint a plausible receipt for a paste that never was, by
    // inventing an id and screenshotting the result. `zzzzzzzz` is well-formed base58, so
    // this cannot pass by being rejected on shape.
    const response = await page.goto("/p/zzzzzzzz");
    expect(response?.status()).toBe(404);
  });

  test("a lapsed paste is 410 and keeps its URL", async ({ page }) => {
    const { id } = await seed({ expiresInMinutes: -60 });

    const response = await page.goto(`/p/${id}`);
    expect(response?.status()).toBe(410);
    // The permalink is the product: the URL must not change for any of these answers.
    expect(new URL(page.url()).pathname).toBe(`/p/${id}`);
    // And the receipt, not a bare error page — that is the composition detail a unit test
    // of the status decision cannot see.
    await expect(page.getByText(/410 Gone/)).toBeVisible();
  });

  test("the view page loads no third-party script", async ({ page }) => {
    const { id } = await seed({});

    const remote: { origin: string; type: string }[] = [];
    const local = (u: string) =>
      u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost");

    page.on("request", (r) => {
      if (local(r.url())) return;
      remote.push({ origin: new URL(r.url()).origin, type: r.resourceType() });
    });

    await page.goto(`/p/${id}`);
    await page.waitForLoadState("networkidle");

    // SCRIPTS AND SUBRESOURCES, not navigations — and the distinction is measured rather
    // than assumed.
    //
    // `ClerkProvider` in the root layout loaded `clerk.browser.js` here, a genuine
    // third-party script on the page that renders hostile text (§6.5). That is what this
    // asserts, and the module-graph test cannot: a page does not import its layout.
    //
    // What remains is one request of type `document` to the Clerk instance origin, with
    // `x-clerk-auth-reason: dev-browser-missing` on the response. That is Clerk's
    // DEVELOPMENT-INSTANCE handshake: a development instance lives on a different domain
    // from the app, so it cannot set a first-party cookie and bounces the browser through
    // its own domain once to do it. A production instance on the app's own domain does not.
    // Asserting zero remote requests would therefore fail only in development and pass in
    // production, which is the wrong way round for a security test — it has to be
    // re-verified against a production instance at M13 rather than encoded here.
    const subresources = remote.filter((r) => r.type !== "document");
    expect(subresources).toEqual([]);
    expect(
      remote.filter((r) => r.type === "script"),
      "a third-party script on the view page",
    ).toEqual([]);
  });

  test("writing is refused", async ({ request }) => {
    // The other half of the premise. Reads are open; this must not be.
    const response = await request.post("/api/pastes?retention=1d", {
      headers: { "Content-Type": "text/plain", Accept: "text/plain" },
      data: "should not be stored\n",
    });

    expect(response.status()).toBe(401);
  });
});
