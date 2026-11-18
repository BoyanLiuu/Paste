import { describe, expect, it } from "vitest";

import { escapeHtml, renderPlain, withLineIds } from "@/lib/render/gutter";

describe("escapeHtml", () => {
  // The body is attacker-supplied by definition. This path has no highlighter to rely
  // on, so it escapes its own output — and the invariant must not depend on Shiki
  // being correct either (§6.5).
  it.each([
    ["<script>alert(1)</script>", "&lt;script&gt;"],
    ["</pre><script>x", "&lt;/pre&gt;"],
    ['<img src=x onerror="y">', "&lt;img"],
    ["a & b", "a &amp; b"],
    ["it's", "it&#39;s"],
  ])("escapes %s", (input, expected) => {
    expect(escapeHtml(input)).toContain(expected);
  });

  it("leaves no raw angle bracket anywhere", () => {
    const hostile = `</pre><script>alert(1)</script><svg onload="x">`;
    const escaped = escapeHtml(hostile);
    expect(escaped).not.toMatch(/[<>]/);
  });

  it("escapes the ampersand first, so an entity cannot be reconstructed", () => {
    // Replacing < before & would turn "&lt;" in the source into "&amp;lt;" — correct —
    // but replacing & last would turn a literal "&lt;" into "&lt;" and render as "<".
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });
});

describe("renderPlain", () => {
  it("emits one line span per line", () => {
    const html = renderPlain("a\nb\nc\n", false);
    expect(html.match(/class="line"/g)).toHaveLength(3);
  });

  it("gives every line an id when the paste asked for numbers", () => {
    const html = renderPlain("a\nb\n", true);
    expect(html).toContain('id="L1"');
    expect(html).toContain('id="L2"');
  });

  it("emits no ids when it did not", () => {
    // Always emitting them doubles the node count of a 20 000-line log for the
    // majority of pastes that never link a line.
    expect(renderPlain("a\nb\n", false)).not.toContain("id=");
  });

  it("puts no line numbers in the DOM", () => {
    // The most common bug in this category: numbers rendered as text or cells get
    // captured by a select-all, so copying the body yields the body plus a column of
    // integers. They come from a CSS counter instead.
    const html = renderPlain("alpha\nbeta\n", true);
    expect(html).not.toMatch(/>\s*1\s*</);
    expect(html).not.toContain(">1<");
  });

  it("keeps a box for an empty line, so it can be numbered and highlighted", () => {
    const html = renderPlain("a\n\nb\n", true);
    expect(html.match(/class="line"/g)).toHaveLength(3);
    expect(html).toContain("&nbsp;");
  });

  it("does not let a hostile body escape its span", () => {
    const html = renderPlain("</code></pre><script>alert(1)</script>", true);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("withLineIds", () => {
  it("numbers Shiki's line spans in order", () => {
    const shiki =
      '<pre><code><span class="line">a</span>\n<span class="line">b</span></code></pre>';
    const out = withLineIds(shiki);
    expect(out).toContain('<span class="line" id="L1"');
    expect(out).toContain('<span class="line" id="L2"');
  });

  it("leaves the text content untouched", () => {
    // It adds an attribute; it must not be able to change what the body says.
    const shiki = '<span class="line">const x = "&lt;b&gt;";</span>';
    expect(withLineIds(shiki)).toContain('const x = "&lt;b&gt;";');
  });

  it("does nothing to markup with no line spans", () => {
    expect(withLineIds("<pre><code>plain</code></pre>")).toBe(
      "<pre><code>plain</code></pre>",
    );
  });
});
