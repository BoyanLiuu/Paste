import { afterEach, describe, expect, it } from "vitest";

import { originFor, pasteUrl } from "@/lib/paste-url";

// The save receipt hands this string to somebody else, so a relative path is a broken
// link. That is the whole reason this function exists rather than being a template literal
// inside the component — the receipt itself cannot be tested (no session for an e2e run,
// and `@testing-library/react` cannot load under the `react-server` resolve condition), so
// the rule most likely to be "simplified" away lives somewhere a test can hold it.

describe("a paste's shareable URL", () => {
  it("is absolute, so it can be pasted anywhere", () => {
    expect(pasteUrl("5CEXkh7Z", "https://paste.example")).toBe(
      "https://paste.example/p/5CEXkh7Z",
    );
    // The failure mode, stated: no origin means no link.
    expect(pasteUrl("5CEXkh7Z", "https://paste.example")).toMatch(
      /^https?:\/\//,
    );
  });

  it("does not double the slash", () => {
    // `window.location.origin` never has a trailing slash, which is why this is a
    // one-line function — but a caller passing a configured base URL might.
    expect(pasteUrl("abc", "https://paste.example")).not.toContain("//p/");
  });
});

describe("originFor", () => {
  const pinned = process.env.PASTE_ORIGIN;
  afterEach(() => {
    if (pinned === undefined) delete process.env.PASTE_ORIGIN;
    else process.env.PASTE_ORIGIN = pinned;
  });

  it("prefers the pin, so a forged Host cannot move the link", () => {
    // The receipt's URL is the thing someone pastes elsewhere. Deriving it from an
    // attacker-controlled `Host` would let a request mint a link pointing at another
    // origin — the same reasoning `view-route.ts` gives for pinning its self-fetch.
    process.env.PASTE_ORIGIN = "https://paste.example";
    expect(originFor("evil.example")).toBe("https://paste.example");
  });

  it("drops a trailing slash on the pin, so the URL has one separator", () => {
    // `https://paste.example/` + `/p/id` is `https://paste.example//p/id`, which resolves
    // but looks broken in the one place whose entire output is a URL someone reads.
    process.env.PASTE_ORIGIN = "https://paste.example/";
    expect(pasteUrl("5CEXkh7Z", originFor(null))).toBe(
      "https://paste.example/p/5CEXkh7Z",
    );
  });

  it("falls back to the request host when nothing is pinned", () => {
    delete process.env.PASTE_ORIGIN;
    expect(originFor("localhost:3025")).toBe("http://localhost:3025");
  });

  it("is a pure function of its argument, which is what fixed the hydration mismatch", () => {
    // THE BUG THIS REPLACES: `pasteUrlForBrowser` read `window.location.origin` and fell
    // back to `""` when `window` was undefined, so the receipt rendered `/p/<id>` on the
    // server and `http://host/p/<id>` on the client — a hydration mismatch on every
    // receipt, which nothing caught because the receipt needed a session to reach until
    // M15. A function that cannot see `window` cannot reproduce it.
    delete process.env.PASTE_ORIGIN;
    expect(originFor("example.test")).toBe(originFor("example.test"));
    expect(String(originFor)).not.toContain("window");
  });
});
