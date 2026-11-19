// The test ARCHITECTURE N11 and §6.2 both rest on.
//
// The view page is the hot path, it renders hostile content, and it must ship one
// client script and no highlighter. Both properties are invisible once broken: adding
// `import { codeToHtml } from "shiki"` to render a body on demand works perfectly in
// development and moves the whole cost onto every view, and importing `motion` for a
// fade adds ~30 KB to the page whose job is to display text.
//
// Written in M3 while it is trivially green. By M7 the import is one autocomplete away.

import { describe, expect, it } from "vitest";

import { moduleGraph, VIEW_ROUTE_ENTRIES } from "@/app/p/module-graph";

// The walker and the entry list moved to `./module-graph.ts` at M12, when the client-JS
// budget needed the same graph. Its comment explains why the LAYOUTS are in that list.

/** Modules a view-route file may not reach, transitively.
 *
 *  `exact` matches the specifier alone; without it a subpath counts too. The distinction
 *  exists because one package can expose both a client and a server entry that differ in
 *  exactly the property under test. */
const FORBIDDEN: {
  specifier: string;
  exact?: boolean;
  why: string;
}[] = [
  {
    specifier: "shiki",
    why: "renders on the read path instead of once at save",
  },
  {
    // EXACT, because `@clerk/nextjs/server` is fine and necessary here.
    //
    // The two entry points do opposite things. `@clerk/nextjs` is the client surface —
    // `ClerkProvider`, `UserButton` — and rendering any of it loads `clerk.browser.js`
    // from the instance's remote origin. `@clerk/nextjs/server` is `auth()`, which runs
    // on the server and ships nothing. The page legitimately reaches the second through
    // `session.ts` to resolve a viewer.
    //
    // Measured, not theoretical: with `ClerkProvider` in the root layout this page pulled
    // the remote script, and the view CSP then blocked it — so Clerk was both unwanted
    // and broken here. A prefix match would have forbidden `auth()` too and forced the
    // wrong fix.
    specifier: "@clerk/nextjs",
    exact: true,
    why: "ClerkProvider loads a remote script onto the page that renders hostile text",
  },
  { specifier: "motion", why: "ships an animation runtime to the hot path" },
  { specifier: "react-hook-form", why: "a form library on a read-only page" },
  { specifier: "zod", why: "a validator on a page that validates nothing" },
];

describe("the view route's module graph", () => {
  const graph = moduleGraph(VIEW_ROUTE_ENTRIES);

  it("reaches the modules it is supposed to", () => {
    // Guards the guard: a walker that silently resolved nothing would pass every
    // assertion below.
    expect(graph.size).toBeGreaterThan(8);
    expect([...graph.keys()]).toContain("src/components/paste-view.tsx");
    expect([...graph.keys()]).toContain("src/lib/expiry/tombstone.ts");
    // And the layout really is in the graph now, which is the whole fix. Without this the
    // Clerk assertion below would pass by never looking at the file that had the problem.
    expect([...graph.keys()]).toContain("src/app/layout.tsx");
    expect([...graph.keys()]).toContain("src/components/app-shell.tsx");
  });

  it.each(FORBIDDEN)(
    "does not reach $specifier — $why",
    ({ specifier, exact }) => {
      const reached = [...graph.entries()].filter(([name]) =>
        exact === true
          ? name === specifier
          : name === specifier || name.startsWith(`${specifier}/`),
      );
      const trails = reached.map(([, trail]) => trail.join("\n    → "));
      expect(
        trails,
        trails.length === 0 ? "" : `reached by:\n    → ${trails[0]}`,
      ).toEqual([]);
    },
  );

  // N11's client-module count lived here and moved to `view-page-budget.spec.ts`, which
  // owns it properly: this copy tested `/^\s*["']use client["']/m`, which matches the
  // directive at the start of ANY line — so a comment quoting the rule read as a client
  // component. It also only counted, where the budget test names the module, so deleting
  // the selection listener and adding a toast would have balanced out and passed.
});
