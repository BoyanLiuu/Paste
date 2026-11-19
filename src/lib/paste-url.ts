// The absolute URL of a paste.
//
// ABSOLUTE, AND THAT IS THE WHOLE POINT. The save receipt exists so someone can hand the
// link to somebody else, and `/p/5CEXkh7Z` pasted into a chat window is not a link. The
// receipt showed exactly that for as long as it existed.
//
// Its own module so the rule is testable. The receipt is a client component that renders
// only after an authenticated save, which makes it reachable by neither suite — an e2e run
// has no session, and a component test cannot load `@testing-library/react` while the
// `react-server` resolve condition is set (see the note in `vitest.config.mts`). So the
// part most likely to regress — someone "simplifying" this back to a relative path — is
// pulled out to where a test can reach it.

/** `origin` is passed in rather than read, so this is pure and works on either side. */
export function pasteUrl(id: string, origin: string): string {
  return `${origin}/p/${id}`;
}

/** What the browser should use. Falls back to a relative path server-side, where there is
 *  no honest origin to invent. */
export function pasteUrlForBrowser(id: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return pasteUrl(id, origin);
}
