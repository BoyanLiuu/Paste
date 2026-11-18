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
const ENTRY = "src/app/p/[id]/page.tsx";

/** Modules a view-route file may not reach, transitively. */
const FORBIDDEN = [
  {
    specifier: "shiki",
    why: "renders on the read path instead of once at save",
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

/** Every module the entry reaches, and the shortest path to each. */
function moduleGraph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];

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
  const graph = moduleGraph(ENTRY);

  it("reaches the modules it is supposed to", () => {
    // Guards the guard: a walker that silently resolved nothing would pass every
    // assertion below.
    expect(graph.size).toBeGreaterThan(8);
    expect([...graph.keys()]).toContain("src/components/paste-view.tsx");
    expect([...graph.keys()]).toContain("src/lib/expiry/tombstone.ts");
  });

  it.each(FORBIDDEN)("does not reach $specifier — $why", ({ specifier }) => {
    const reached = [...graph.entries()].filter(
      ([name]) => name === specifier || name.startsWith(`${specifier}/`),
    );
    const trails = reached.map(([, trail]) => trail.join("\n    → "));
    expect(
      trails,
      trails.length === 0 ? "" : `reached by:\n    → ${trails[0]}`,
    ).toEqual([]);
  });

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
