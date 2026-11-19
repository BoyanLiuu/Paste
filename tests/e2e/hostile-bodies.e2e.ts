import { expect, test } from "@playwright/test";

import { cleanUpSeeded, seed } from "./fixture";

// The failure that turns this product into an XSS delivery service for its own users'
// sessions (ARCHITECTURE §6.5, N6, M12).
//
// A paste site renders text that someone else wrote. That is not an edge case here, it is
// the entire function — so `</pre><script>alert(1)</script>` is not a hostile input to be
// rejected, it is a perfectly reasonable snippet that must be DISPLAYED and must not run.
// Both halves matter: a version of this that stripped the text would pass an "it didn't
// execute" test and be useless as a paste site.
//
// WHY END-TO-END AND NOT A UNIT TEST. The view page sets `dangerouslySetInnerHTML` with
// markup this project generated from text it escaped at tokenisation — four steps, each
// correct in isolation. What could go wrong is their composition: an escape that happens
// before a transformer that re-emits raw, a fallback path that escapes differently from the
// highlighted one, a title interpolated somewhere the body never reaches. Only a real
// browser can answer "did anything execute", and that is the assertion with no proxy.
//
// EVERY FAILURE HERE IS SILENT. A page with a working `<script>` in it looks exactly like a
// page without one. No status code, no log line, no visual difference — which is why the
// plan names this the one suite where a silent pass is the worst possible outcome, and why
// the dialog listener below is registered before the first navigation rather than after.

test.afterAll(cleanUpSeeded);

/**
 * The corpus. Each entry is a real thing someone would paste, chosen for the escape it
 * breaks rather than for looking dangerous.
 */
const BODIES = {
  // Closes the element the body is rendered inside. The single most likely way this breaks:
  // every other payload is inert while the content stays inside `<pre>`.
  "closes its own pre": '</pre><script>alert("xss")</script>\n',

  // No script tag at all, so a filter looking for `<script` passes it straight through.
  "an img with onerror": '<img src=x onerror="alert(1)">\n',

  // SVG's parsing rules differ from HTML's, and `onload` fires without user interaction.
  "an svg with onload": '<svg onload="alert(1)"></svg>\n',

  // If anything serves this as `text/html` the browser treats the whole response as a
  // document rather than as content — the raw origin's reason for existing (§6.5).
  "a whole html document":
    "<!doctype html>\n<html><body><script>alert(1)</script></body></html>\n",

  // The escape has to survive the highlighter's tokenisation, not just a final pass. An
  // entity inside a string literal is where a double-unescape shows up.
  "entities inside a string literal":
    'const s = "&lt;script&gt;alert(1)&lt;/script&gt;";\n',

  // Breaks out of an attribute rather than an element, for anything interpolated into one.
  "an attribute breakout": '" onmouseover="alert(1)" x="\n',
} as const;

/** Anything that executes calls one of these. Nothing on the page should. */
async function watchForExecution(page: import("@playwright/test").Page) {
  const fired: string[] = [];

  // REGISTERED BEFORE THE NAVIGATION. A dialog opened during load and never handled hangs
  // the page, and a listener attached afterwards misses it entirely — so the test would
  // time out rather than fail, and a timeout reads as flake.
  page.on("dialog", async (dialog) => {
    fired.push(`dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  page.on("pageerror", (error) => {
    // A thrown error is not execution of the payload, but it is the signature of markup
    // that parsed in a way nobody intended.
    fired.push(`pageerror: ${error.message}`);
  });

  return fired;
}

test.describe("a hostile body", () => {
  for (const [name, body] of Object.entries(BODIES)) {
    test(`${name} is displayed and does not execute`, async ({ page }) => {
      const { id } = await seed({ body, language: "html" });
      const fired = await watchForExecution(page);

      const response = await page.goto(`/p/${id}`);
      expect(response?.status()).toBe(200);
      await page.waitForLoadState("networkidle");

      // NOTHING RAN.
      expect(fired, `payload executed: ${name}`).toEqual([]);

      // AND NO ELEMENT WAS CREATED. A payload can land in the DOM without firing — an
      // `<img src=x>` whose request fails silently, a `<script>` the CSP blocked. Either
      // would mean the escape failed and only the policy saved it, which is one
      // misconfiguration away from executing.
      const injected = await page.evaluate(() => {
        const body = document.getElementById("paste-body");
        return {
          scripts: body?.querySelectorAll("script").length ?? -1,
          images: body?.querySelectorAll("img").length ?? -1,
          svgs: body?.querySelectorAll("svg").length ?? -1,
          handlers:
            body?.querySelectorAll("[onerror],[onload],[onmouseover]").length ??
            -1,
        };
      });
      expect(injected).toEqual({
        scripts: 0,
        images: 0,
        svgs: 0,
        handlers: 0,
      });

      // AND THE TEXT IS THERE. The whole point: a paste site that silently dropped this
      // content would pass every assertion above and be worthless. Checked on the first
      // distinctive run of characters, since the highlighter splits the line into spans.
      const shown = await page.locator("#paste-body").innerText();
      const distinctive = body.trim().slice(0, 12);
      expect(shown, `content was dropped, not escaped: ${name}`).toContain(
        distinctive,
      );
    });
  }

  test("the download endpoint saves bytes rather than rendering them", async ({
    request,
  }) => {
    const body = BODIES["a whole html document"];
    const { id } = await seed({ body, language: "html" });

    const download = await request.get(`/dl/${id}`);
    expect(download.status()).toBe(200);
    const headers = download.headers();

    // `attachment` IS THE DEFENCE, and this is the assertion that says so. These bytes are
    // a complete HTML document with a script in it — exactly what someone would paste —
    // and the disposition is what makes the browser save them instead of rendering them.
    // There is then no origin for the script to run in, which is what replaced §6.5's
    // separate registrable domain. If this header ever weakens to `inline`, every paste on
    // the service becomes a stored page on the app's own origin.
    expect(headers["content-disposition"]).toContain("attachment");

    // `text/plain`, EXACTLY, as depth. `text/html` here would matter again the moment
    // anything downstream ignored the disposition — and `charset` matters too: without it a
    // browser may sniff UTF-16 from a crafted prefix and reinterpret the whole body.
    expect(headers["content-type"]).toBe("text/plain; charset=utf-8");
    // `nosniff` stops a browser overriding the type above on content.
    expect(headers["x-content-type-options"]).toBe("nosniff");
    // And a sandbox policy, so even if everything above were wrong the document that
    // resulted could not run scripts or carry an origin.
    expect(headers["content-security-policy"]).toContain("sandbox");

    // Byte-for-byte, because that is the contract and because an escape applied here would
    // corrupt what the reader opens in an editor.
    expect(await download.text()).toBe(body);
  });

  test("a hostile title does not escape the page it titles", async ({
    page,
  }) => {
    // The title is a separate interpolation from the body, reaches `<title>` and `<h1>`,
    // and is the field most likely to be rendered by a component that never considered
    // this. It also goes through `generateMetadata`, which is a different code path from
    // the page body.
    const title = '<svg onload="alert(1)"></svg>';
    const { id } = await seed({ body: "x = 1\n", title });
    const fired = await watchForExecution(page);

    await page.goto(`/p/${id}`);
    await page.waitForLoadState("networkidle");

    expect(fired, "a title payload executed").toEqual([]);
    // Shown as text, including in the document title, where a naive implementation would
    // have produced a parsed element.
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    expect(await page.title()).toContain("svg onload");
    expect(await page.locator("svg[onload]").count()).toBe(0);
  });

  test("a hostile filename cannot inject a response header", async ({
    request,
  }) => {
    // `Content-Disposition` carries a filename derived from user input, so a newline in it
    // is header injection and a quote is a parameter breakout. RFC 5987 encoding is the
    // answer, and the failure is invisible from the page — only the raw header shows it.
    const title =
      'report";\r\nX-Injected: yes\r\n\r\n<script>alert(1)</script>';
    const { id } = await seed({ body: "x = 1\n", title });

    const response = await request.get(`/dl/${id}`);
    expect(response.status()).toBe(200);

    const headers = response.headers();
    // NO INJECTED HEADER. If a CRLF survived, this is the one assertion that sees it —
    // everything downstream would read a response with an extra header and a body that
    // began early, and nothing on the page would look wrong.
    expect(headers["x-injected"]).toBeUndefined();

    const disposition = headers["content-disposition"];
    expect(disposition).toContain("attachment");

    // THE TWO FAILURES THAT MATTER, and they are about structure rather than content:
    //
    //   CR or LF        ends the header and starts another one — injection.
    //   " or \\          closes the quoted parameter — a breakout into header syntax.
    //
    // Note what is deliberately NOT asserted: the ASCII fallback still CONTAINS the text
    // `<script>alert(1)</script>`, and that is correct. Inside a quoted parameter those are
    // ordinary characters; they name a file, they do not parse as markup, and RFC 6266 has
    // clients prefer `filename*` regardless. An earlier version of this test refused
    // `<script` anywhere in the header and failed against code that was right — the
    // assertion was testing for scary-looking text instead of for the defect.
    expect(disposition, "header injection via CR/LF").not.toMatch(/[\r\n]/);
    const quoted = disposition.match(/filename="([^"]*)"/);
    expect(
      quoted,
      "the quoted parameter did not survive as one token",
    ).not.toBeNull();
    expect(
      quoted![1],
      "a quote or backslash escaped the parameter",
    ).not.toMatch(/["\\]/);

    // RFC 5987: the real value, percent-encoded, which is what a modern client uses.
    expect(disposition).toMatch(/filename\*=UTF-8''/);
    expect(disposition).toContain(encodeURIComponent("<script>"));

    // AND THE FALLBACK IS BOUNDED. A title is up to 25 MB of attacker-chosen bytes; an
    // unbounded fallback makes the response header that size, which most proxies answer
    // with a 431 or 502 — the download endpoint broken by a title nobody can see.
    expect(quoted![1].length).toBeLessThanOrEqual(100);
  });
});
