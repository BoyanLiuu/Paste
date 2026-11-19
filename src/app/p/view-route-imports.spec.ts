import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The test ARCHITECTURE N11 and §6.2 both rest on.
//
// The view page is the hot path, it renders hostile content, and it must ship one
// client script and no highlighter. Both properties are invisible once broken: adding
// `import { codeToHtml } from "shiki"` to render a body on demand works perfectly in
// development and moves the whole cost onto every view, and importing `motion` for a
// fade adds ~30 KB to the page whose job is to display text.
//
// Written in M3 while it is trivially green. By M7 the import is one autocomplete away.

const ROOT = resolve(import.meta.dirname, "../../..");

/**
 * Everything Next composes to serve /p/:id — the page AND every layout above it.
 *
 * THE LAYOUTS ARE THE POINT. This test walked the page alone for three milestones, and a
 * page does not import its layout: Next composes them. So `clerk init` putting
 * `ClerkProvider` in the root layout was completely invisible here, while the running
 * server showed `/p/:id` loading `clerk.browser.js` from a remote clerk.accounts.dev
 * origin — a third-party script on the one page that renders attacker-supplied text.
 * The test passed throughout.
 *
 * A guard that cannot see half of what it guards is worse than no guard, because it is
 * trusted. Any layout added between `src/app` and the route now joins this list
 * automatically.
 */
const ENTRIES = [
  "src/app/p/[id]/page.tsx",
  ...["src/app/p/[id]", "src/app/p", "src/app"]
    .map((dir) => `${dir}/layout.tsx`)
    .filter((file) => {
      try {
        readFileSync(resolve(ROOT, file), "utf8");
        return true;
      } catch {
        return false;
      }
    }),
];

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

/** Resolves the relative and alias imports this project uses. Deliberately not a
 *  bundler: a 40-line walker that understands `@/` and relative paths covers every
 *  import in this codebase, and a bundler would make the test slow enough to skip. */
function readImports(file: string): string[] {
  const source = readFileSync(resolve(ROOT, file), "utf8");
  return [
    ...source.matchAll(/^\s*(?:import|export)[^'"]*from\s*["']([^"']+)["']/gm),
  ]
    .map((m) => m[1])
    .concat(
      [...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map(
        (m) => m[1],
      ),
    );
}

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) {
    base = resolve(dirname(resolve(ROOT, fromFile)), specifier).slice(
      ROOT.length + 1,
    );
  } else return null;

  for (const extension of ["", ...EXTENSIONS]) {
    try {
      const candidate = `${base}${extension}`;
      readFileSync(resolve(ROOT, candidate), "utf8");
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

/** Every module the entries reach, and the shortest path to each. */
function moduleGraph(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>(entries.map((e) => [e, [e]]));
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.shift()!;
    const trail = seen.get(file)!;
    for (const specifier of readImports(file)) {
      const local = resolveLocal(specifier, file);
      if (local === null) {
        // A bare specifier: a package. Record it as a leaf so the assertion can see it.
        if (!seen.has(specifier)) seen.set(specifier, [...trail, specifier]);
        continue;
      }
      if (seen.has(local)) continue;
      seen.set(local, [...trail, local]);
      queue.push(local);
    }
  }
  return seen;
}

describe("the view route's module graph", () => {
  const graph = moduleGraph(ENTRIES);

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

  it("ships exactly one client component", () => {
    // N11: one client script on this page. Any other "use client" module in the graph
    // is a second bundle on the page that renders hostile content.
    const clientModules = [...graph.keys()].filter((name) => {
      if (!name.startsWith("src/")) return false;
      try {
        return /^\s*["']use client["']/m.test(
          readFileSync(resolve(ROOT, name), "utf8"),
        );
      } catch {
        return false;
      }
    });
    expect(clientModules).toEqual(["src/components/range-select-mount.tsx"]);
  });
});
