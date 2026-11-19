import { expect, test } from "@playwright/test";

// The sign-in page, on a HARD LOAD (ARCHITECTURE §6.5, M10).
//
// WHAT THIS CATCHES, and what missed it. `/sign-in` was a blank screen on reload and
// perfectly fine when reached by clicking "Sign in". The policy on the Clerk pages had no
// nonce, so Next's hydration bootstrap and the RSC payload — both INLINE scripts, on every
// page — were blocked before Clerk was reached. A client-side navigation hid it completely:
// that document came from `/`, which carries no policy, so the header on the `/sign-in`
// response never applied.
//
// Three things looked at this route and none of them saw it:
//
//   - `view-page-csp.spec.ts` asserted the policy had NO nonce, with a confident and wrong
//     explanation of what a nonce is for. The bug lived inside a passing assertion.
//   - `public-reads.e2e.ts` covers `/` and `/p/:id`, not this.
//   - A status probe in this session returned 200 and I moved on. A blank document is a
//     200 — which is the "verify the artefact, not a proxy for it" lesson from Appendix H,
//     reached again.
//
// So this asserts the rendered form from a cold navigation, and separately asserts the
// mechanism: that Next's inline scripts carry the nonce. The second check is read off the
// DOM rather than the console, because a violation message names a hash and cannot say
// which script it refused.

test.describe("the sign-in page", () => {
  test("renders its form on a cold load", async ({ page }) => {
    const response = await page.goto("/sign-in");
    expect(response?.status()).toBe(200);

    // THE FORM, not the status. Clerk renders its own markup client-side, so this is only
    // on the page if the framework hydrated — which is exactly what the policy was
    // preventing. The status was 200 throughout.
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("has its inline scripts stamped with the nonce", async ({ request }) => {
    // THE MECHANISM, read off the SERVER'S HTML rather than the DOM or the console.
    //
    // Not the console: a violation message names a hash, so it cannot say which script it
    // refused. Not the DOM: browsers CLEAR the nonce attribute after parsing — nonce
    // hiding, so a CSS selector cannot exfiltrate it — so `getAttribute("nonce")` returns
    // an empty string and a DOM count reports every script as unstamped. That cost a
    // detour here: the check said 6 of 6 unstamped against a page that was working.
    //
    // The response body is the thing the policy is applied to, and it is not rewritten.
    //
    // Measured before the fix: 6 inline scripts, 0 stamped. All of them Next's own —
    // `__NEXT_CLIENT_RESUME`, `$RT`, `$RX`, TURBOPACK, `__next_f`.
    const html = await (await request.get("/sign-in")).text();

    const inline = [
      ...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]{0,60})/g),
    ];
    expect(inline.length).toBeGreaterThan(3);

    const unstamped = inline
      .filter((m) => !m[1].includes("nonce="))
      .map((m) => m[2].replace(/\s+/g, " ").slice(0, 45));

    // EXACTLY ONE, and it is named. React writes this timing marker into the prerendered
    // shell, so it predates the request and no per-request nonce can reach it — `/p/:id`
    // carries the same one and has since M8. Allowing it BY NAME rather than by count
    // keeps the guard sharp: a new unstamped script still fails here.
    expect(
      unstamped,
      `unstamped inline scripts: ${unstamped.join(" | ")}`,
    ).toHaveLength(1);
    expect(unstamped[0]).toContain("$RT");
  });

  test("still carries its own policy, not the view page's and not none", async ({
    page,
  }) => {
    const response = await page.goto("/sign-in");
    const csp = response?.headers()["content-security-policy"] ?? "";

    // A nonce, so the framework runs…
    expect(csp).toMatch(/script-src [^;]*'nonce-/);
    // …and Clerk's own origin, so its component can load…
    expect(csp).toMatch(/script-src [^;]*clerk/);
    // …but no `'unsafe-inline'` on scripts, which would make the nonce decorative.
    const scriptSrc = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    // And it is still a deny-by-default policy. Looser than the view page is not the same
    // as permissive: this is the page where credentials get typed.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test("sign-up renders too", async ({ page }) => {
    // The same branch serves both, and a fix applied to one path only is the usual shape
    // of this mistake.
    await page.goto("/sign-up");
    await expect(
      page.getByRole("heading", { name: /sign up|create/i }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("has the app shell, so there is a way back", async ({ page }) => {
    // THE PAGE WAS A ONE-WAY DOOR. A bare centred card on an otherwise empty document: no
    // wordmark, no nav, nothing to click. A visitor who arrived and changed their mind had
    // the browser's back button and nothing else — and that is worse than it sounds on the
    // route reached by the only link a signed-out visitor has.
    await page.goto("/sign-in");

    const home = page.getByRole("link", { name: "Paste", exact: true });
    await expect(home).toBeVisible();

    // AND IT GOES HOME, rather than merely existing. A header whose wordmark is not a link
    // looks identical.
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel("Text")).toBeVisible();
  });

  test("sign-up has it too", async ({ page }) => {
    // The same branch serves both, and a fix applied to one path only is the usual shape
    // of this mistake — the CSP fix above had to be made twice for the same reason.
    await page.goto("/sign-up");
    await expect(
      page.getByRole("link", { name: "Paste", exact: true }),
    ).toBeVisible();
  });
});
