// A static import walker, shared by the two tests that guard the view route (N2, N11).
//
// EXTRACTED AT M12, when the client-JS budget needed the same graph the forbidden-import
// guard already walked. The alternative was a second copy — and this walker has one
// hard-won property that a copy would have silently lacked:
//
//   IT INCLUDES THE LAYOUTS. A page does not import its layout; Next composes them. The
//   first version walked `page.tsx` alone for three milestones, so `clerk init` putting
//   `ClerkProvider` in the root layout was completely invisible to it while the running
//   server loaded `clerk.browser.js` onto the page that renders attacker-supplied text.
//   The test passed throughout. A guard that cannot see half of what it guards is worse
//   than no guard, because it is trusted.
//
// Deliberately not a bundler. A 40-line walker that understands `@/` and relative paths
// covers every import in this codebase, and a bundler would make these tests slow enough
// that someone turns them off. It follows `import()` as well as static `import`, because a
// dynamic import is still in the route's server bundle and a lazy highlighter would
// otherwise pass.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../../..");

/** Everything Next composes to serve /p/:id — the page AND every layout above it. */
export const VIEW_ROUTE_ENTRIES = [
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

export function readImports(file: string): string[] {
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

export function resolveLocal(
  specifier: string,
  fromFile: string,
): string | null {
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
export function moduleGraph(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>(entries.map((e) => [e, [e]]));
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.shift()!;
    const trail = seen.get(file)!;
    for (const specifier of readImports(file)) {
      const local = resolveLocal(specifier, file);
      if (local === null) {
        // A bare specifier: a package. Record it as a leaf so assertions can see it.
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

/** Whether a local module is a client component — the `"use client"` boundary. */
export function isClientModule(file: string): boolean {
  if (!file.startsWith("src/")) return false;
  try {
    const source = readFileSync(resolve(ROOT, file), "utf8");
    // The directive has to be the first statement, so a mention of the string deeper in a
    // file — in a comment explaining the rule, for instance — is not a false positive.
    return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(
      source,
    );
  } catch {
    return false;
  }
}
