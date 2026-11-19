import { describe, expect, it } from "vitest";

import * as mutations from "@/lib/server/mutations";
import { NotImplementedInStaticPhase } from "@/lib/server/mutations";
import * as service from "@/lib/server/paste-service";
import { getViewer } from "@/lib/server/viewer";
import type { Viewer } from "@/lib/types";

// Catches the signature drift that would make phase 2 a rewrite rather than a swap.
//
// ARCHITECTURE Appendix C promises two properties: every service function is already
// `async`, and every owner-scopable one already takes the viewer first. Both are easy
// to hold now and expensive to retrofit, because breaking either means touching every
// call site in every screen built between here and M8.

const VIEWER: Viewer = { kind: "anon" };

/** Keyed on a revision, not on an owner, so there is nothing for a viewer to scope.
 *  Exempt by name rather than by giving it an argument it would never read. */
const NOT_OWNER_SCOPED = new Set(["getRender"]);

function firstParamName(fn: (...args: never[]) => unknown): string {
  // esbuild preserves parameter names, so the source text is readable here. Underscore
  // prefixes are TypeScript's unused marker and mean the same thing to a reader.
  const src = fn.toString();
  const params = src.slice(src.indexOf("(") + 1, src.indexOf(")"));
  return (params.split(",")[0] ?? "")
    .trim()
    .replace(/^_/, "")
    .split(/[:=\s]/)[0];
}

const exportedFunctions = (mod: object) =>
  Object.entries(mod).filter(
    (entry): entry is [string, (...args: never[]) => unknown] =>
      typeof entry[1] === "function",
  );

describe("service contract", () => {
  const fns = exportedFunctions(service).filter(
    ([name]) => !NOT_OWNER_SCOPED.has(name),
  );

  it("exports the functions the screens are built against", () => {
    const names = exportedFunctions(service).map(([n]) => n);
    expect(names).toContain("getPaste");
    expect(names).toContain("getRender");
    expect(names).toContain("listPastes");
    expect(names).toContain("getRaw");
  });

  it.each(fns)("%s takes the viewer first", (_name, fn) => {
    expect(firstParamName(fn)).toBe("viewer");
  });

  // Each is called with arguments of the right shape for its own signature: passing a
  // viewer where getRender wants a revision id would pass by accident.
  it.each(exportedFunctions(service))("%s is declared async", (name, fn) => {
    // Checked statically rather than by calling.
    //
    // This used to invoke each function with a table of fixture-shaped arguments and
    // assert the result was a Promise. That worked while the service read fixtures and
    // broke the moment it read Postgres: `getRender` takes a revision uuid, the table
    // still held `"7fK2mQxZ:1"`, and the test failed on an invalid-uuid error that said
    // nothing about the property under test. Maintaining valid arguments for every
    // function here would also make this file a second, worse integration suite.
    //
    // `AsyncFunction` is what Appendix C actually promises: every service function is
    // already async, so M8 could swap the implementation without a caller changing shape.
    expect(fn.constructor.name, name).toBe("AsyncFunction");
  });
});

describe("viewer", () => {
  it("resolves asynchronously, so M10 can await Clerk without a call-site change", async () => {
    const returned = getViewer();
    expect(returned).toBeInstanceOf(Promise);
    const viewer = await returned;
    expect(viewer.kind).toBe("user");
  });
});

describe("mutations", () => {
  const fns = exportedFunctions(mutations).filter(
    ([name]) => !name.startsWith("NotImplemented"),
  );

  it("declares all four mutations the product needs", () => {
    const names = fns.map(([n]) => n);
    expect(names.toSorted()).toEqual([
      "createPaste",
      "decideRequest",
      "forkPaste",
      "requestRemoval",
    ]);
  });

  it.each(fns)("%s takes the viewer first", (_name, fn) => {
    expect(firstParamName(fn)).toBe("viewer");
  });

  /** Implemented, and therefore no longer expected to refuse. M7 landed `createPaste`;
   *  the others land in M11, and each moves out of this list as it does. */
  const IMPLEMENTED = new Set(["createPaste"]);

  // The message is shown by the "nothing was sent" screens and names the milestone that
  // implements it, so it is contract rather than debug text.
  it.each(fns.filter(([name]) => !IMPLEMENTED.has(name)))(
    "%s rejects with NotImplementedInStaticPhase",
    async (name, fn) => {
      await expect(
        (fn as (...a: unknown[]) => Promise<unknown>)(VIEWER, "7fK2mQxZ", {}),
      ).rejects.toThrow(NotImplementedInStaticPhase);
      await expect(
        (fn as (...a: unknown[]) => Promise<unknown>)(VIEWER, "7fK2mQxZ", {}),
      ).rejects.toThrow(/not implemented in the static phase/);
      expect(name).toBeTruthy();
    },
  );

  it("still declares the refusal the unimplemented mutations share", () => {
    // The class stays until the last mutation lands. Deleting it the moment one mutation
    // is implemented would silently drop the contract the "nothing was sent" screens
    // (ux-05, 36, 44, 46) are built against, and those screens have no other signal.
    expect(IMPLEMENTED.size).toBeLessThan(fns.length);
    expect(new NotImplementedInStaticPhase("x", "M11").message).toMatch(
      /not implemented in the static phase/,
    );
  });
});
