import { describe, expect, it } from "vitest";

import { pasteUrl } from "@/lib/paste-url";

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
