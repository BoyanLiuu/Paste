// Why a fork was refused, as a value the view page can read off a query string.
//
// IN ITS OWN MODULE BECAUSE OF N11, not for tidiness. The view page needs this union to
// render the banner, and anything that can call `forkPaste` transitively imports the create
// path — which imports the highlighter, because stage 8 renders. So the union cannot live
// beside the code that produces it: `view-route-imports.spec.ts` walks `import type` the
// same as a value import, and correctly, since a type import from a module with side
// effects is one refactor away from being a real one.
//
// This file imports nothing. That is the property that matters about it.

export type ForkProblem = "blocked" | "override" | "gone" | "signin" | "failed";

/** For validating `?fork=`, which is attacker-supplied like any query parameter. */
export const FORK_PROBLEMS: ForkProblem[] = [
  "blocked",
  "override",
  "gone",
  "signin",
  "failed",
];

export function asForkProblem(value: unknown): ForkProblem | null {
  return typeof value === "string" &&
    FORK_PROBLEMS.includes(value as ForkProblem)
    ? (value as ForkProblem)
    : null;
}
