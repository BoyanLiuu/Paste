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
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Not a redirect. `/` is where someone arrives from a link, and bouncing them to a
    // sign-in wall before they have typed anything is the opposite of the product.
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
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

  test("the raw and download endpoints serve bytes", async ({ request }) => {
    const { id, body } = await seed({ body: "line one\nline two\n" });

    const raw = await request.get(`/raw/${id}`);
    expect(raw.status()).toBe(200);
    expect(raw.headers()["content-type"]).toContain("text/plain");
    // Byte-for-byte, because this is what a CLI pipes into a file.
    expect(await raw.text()).toBe(body);

    const download = await request.get(`/dl/${id}`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
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
