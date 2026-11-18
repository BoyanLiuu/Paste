import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountRangeSelect } from "@/components/range-select";
import { renderPlain } from "@/lib/render/gutter";

// Two properties, both of which fail silently.
//
// The history one is the sharper: assigning to `location.hash` instead of calling
// replaceState pushes an entry per click, so someone who shift-clicks around a log
// and then presses Back is trapped scrolling through their own selections instead of
// leaving the page. Everything still looks correct until you try to leave.

const BODY = ["one", "two", "three", "four", "five", "six"].join("\n");

function mount({ numbered = true }: { numbered?: boolean } = {}) {
  document.body.innerHTML = `<div id="b" data-line-count="6">${renderPlain(BODY, numbered)}</div>`;
  const container = document.getElementById("b")!;
  const teardown = mountRangeSelect(container);
  return { container, teardown };
}

function clickLine(container: HTMLElement, n: number, shift = false) {
  container
    .querySelector(`#L${n}`)!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: shift }));
}

const selected = (container: HTMLElement) =>
  [...container.querySelectorAll(".line.hl")].map((el) => el.id);

beforeEach(() => {
  history.replaceState(null, "", "/p/test");
  document.body.innerHTML = "";
});

describe("range selection", () => {
  it("anchors on a click and extends on shift-click", () => {
    const { container } = mount();
    clickLine(container, 2);
    expect(selected(container)).toEqual(["L2"]);
    clickLine(container, 5, true);
    expect(selected(container)).toEqual(["L2", "L3", "L4", "L5"]);
  });

  it("extends upwards too", () => {
    const { container } = mount();
    clickLine(container, 5);
    clickLine(container, 2, true);
    expect(selected(container)).toEqual(["L2", "L3", "L4", "L5"]);
  });

  it("writes the canonical fragment to the URL", () => {
    const { container } = mount();
    clickLine(container, 3);
    expect(location.hash).toBe("#L3");
    clickLine(container, 6, true);
    expect(location.hash).toBe("#L3-L6");
  });

  it("leaves exactly one history entry after ten shift-clicks", () => {
    // Catches `location.hash = …`, which pushes an entry per click. The assertion is
    // on the spy rather than history.length because jsdom does not expose a count
    // that distinguishes push from replace.
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const { container } = mount();

    clickLine(container, 1);
    for (let n = 2; n <= 6; n += 1) clickLine(container, n, true);
    for (let n = 6; n >= 2; n -= 1) clickLine(container, n, true);

    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
    push.mockRestore();
    replace.mockRestore();
  });

  it("paints the range named by the fragment on mount", () => {
    history.replaceState(null, "", "/p/test#L2-L4");
    const { container } = mount();
    expect(selected(container)).toEqual(["L2", "L3", "L4"]);
  });

  it("paints nothing for a fragment past the end", () => {
    // A truncated or hand-edited URL must not produce a blank page or a throw.
    history.replaceState(null, "", "/p/test#L99");
    const { container } = mount();
    expect(selected(container)).toEqual([]);
  });

  it("does nothing on a paste with no line numbers", () => {
    // No ids means no anchors, which is intended: numbering is a stored property, so
    // #L42 means something for every reader or for none (§6.2).
    const { container } = mount({ numbered: false });
    container
      .querySelector(".line")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selected(container)).toEqual([]);
  });

  it("stops listening after teardown", () => {
    const { container, teardown } = mount();
    teardown();
    clickLine(container, 2);
    expect(selected(container)).toEqual([]);
  });
});
