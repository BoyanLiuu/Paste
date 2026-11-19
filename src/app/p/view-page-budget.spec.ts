// @vitest-environment node

// The client-JavaScript budget on the hot path (ARCHITECTURE N11, M12).
//
// N11 is a stated number: the view page ships ONE client script. `range-select.ts`, the
// listener that turns a line-number drag into a `#L12-L20` fragment, is the one. Everything
// else on the page — the metadata panel, the expiry readout, the fork form, the redaction
// notice — is a Server Component rendering HTML.
//
// WHY A NUMBER AND NOT A PRINCIPLE. "Keep the view page light" loses every argument against
// a specific, reasonable request: a copy button needs `onClick`, a relative timestamp needs
// a tick, a toast needs a portal. Each is small and each is a client component, and the page
// whose entire job is to display text ends up shipping a framework's worth of interactivity
// to do it. A count that fails the build is the only version of this rule that survives
// contact with a feature request.
//
// COUNTED STATICALLY, from the same graph the forbidden-import guard walks — including the
// LAYOUTS, which is the property that took three milestones to get right and is why both
// tests share one walker. A runtime count in a browser would measure Next's framework
// chunks too, so it could not distinguish "one client component" from "one more than last
// week".
//
// This test exists because M11 added a `<form>` to this page. That one happens to need no
// JavaScript — a plain POST to a route — but the next one will be asked for as a button.

import { describe, expect, it } from "vitest";

import {
  isClientModule,
  moduleGraph,
  VIEW_ROUTE_ENTRIES,
} from "@/app/p/module-graph";

/** The budget. One, and the module that spends it. */
const BUDGET = 1;
const EXPECTED = "src/components/body-tools.tsx";

describe("the view page's client-JavaScript budget", () => {
  const graph = moduleGraph(VIEW_ROUTE_ENTRIES);
  const clientModules = [...graph.keys()].filter(isClientModule).sort();

  it("ships exactly the one client component N11 allows", () => {
    // Named, not just counted. A count alone passes if someone deletes the selection
    // listener and adds a toast — the budget would hold while the feature it was protecting
    // disappeared.
    expect(
      clientModules,
      `client components reachable from /p/:id:\n  ${clientModules.join("\n  ") || "(none)"}`,
    ).toEqual([EXPECTED]);
    expect(clientModules).toHaveLength(BUDGET);
  });

  it("walks a graph big enough to be meaningful", () => {
    // Guards the guard. A walker that resolved nothing would report zero client components
    // and pass the assertion above with a congratulatory message.
    expect(graph.size).toBeGreaterThan(8);
    expect([...graph.keys()]).toContain("src/components/paste-view.tsx");
    expect([...graph.keys()]).toContain("src/app/layout.tsx");
    // And it can actually recognise a client module when it sees one, which is the other
    // way this test could quietly become vacuous.
    expect(isClientModule("src/components/create-form.tsx")).toBe(true);
    expect(isClientModule("src/components/paste-view.tsx")).toBe(false);
  });

  it("does not count a comment mentioning the directive", () => {
    // `paste-view.tsx` discusses the client boundary in prose, and several modules name
    // `"use client"` while explaining why they do not use it. A substring check would read
    // those as client components and the budget would fail for the wrong reason — which is
    // worse than failing to catch a real one, because the fix would be to delete a comment.
    expect(isClientModule("src/app/p/module-graph.ts")).toBe(false);
    expect(isClientModule("src/app/p/view-page-budget.spec.ts")).toBe(false);
  });
});
