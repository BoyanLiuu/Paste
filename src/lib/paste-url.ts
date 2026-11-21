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

/**
 * The origin for a server render, from the pin or the request.
 *
 * REPLACES `pasteUrlForBrowser`, WHICH COULD NOT WORK. That function read
 * `window.location.origin` and fell back to `""` when `window` was undefined — so the
 * receipt rendered `/p/oz39ZBey` on the server and `http://localhost:3025/p/oz39ZBey` on
 * the client, and React reported a hydration mismatch every single time it appeared.
 *
 * The comment above explains why it shipped that way and never got caught: the receipt only
 * renders after a save, which needed a session, so neither suite could reach it. M15 made
 * saving possible without one — and the first person to use the feature saw the error.
 *
 * A client component cannot know the origin before hydration, so it must not try. The
 * server knows it, and passes it down.
 */
export function originFor(host: string | null): string {
  const pinned = process.env.PASTE_ORIGIN;
  if (pinned !== undefined && pinned !== "") return pinned.replace(/\/$/, "");

  // The request's own host, which is what `plainUrl` in the create route already uses.
  // `http` locally: a deployment that terminates TLS pins `PASTE_ORIGIN` and never lands
  // here.
  return host === null ? "" : `http://${host}`;
}
