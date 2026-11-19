import "server-only";

import { getPaste } from "@/lib/server/paste-service";
import type { Viewer } from "@/lib/types";

// Whether the "Saved." panel may be shown for an id on the URL (§6.3).
//
// WHY THIS IS A MODULE AND NOT TWO LINES IN THE PAGE. The first version of the create page
// decided this with `isPasteId` alone — a SHAPE check — so `?saved=zzzzzzzz` rendered a
// complete receipt for a paste that never existed, with a "View paste" button answering
// 404, and `?saved=<anyone else's id>` rendered one claiming the viewer had saved somebody
// else's paste. That is the forged receipt §6.3 refuses for tombstones, reached from the
// other end: an unknown id answers 404 rather than 410 precisely so that nobody can mint a
// plausible screenshot.
//
// It lives here so a test can reach it. The panel itself cannot be tested — it needs a
// Clerk session to own a paste, and a component test cannot load `@testing-library/react`
// under the `react-server` resolve condition (see `vitest.config.mts`) — so the decision
// is pulled out to where the database harness can hold it, and the rendering is what goes
// untested rather than the rule.

/** The two things "Saved." claims: the paste exists, and the viewer is the one who made it. */
export async function mayShowSavedReceipt(
  viewer: Viewer,
  id: string,
): Promise<boolean> {
  // An anon viewer first and without a query. Saving requires a session, so a signed-out
  // visitor cannot have saved anything — and this is the common case for a request that
  // carries the parameter at all, since the honest way to get one is to have just saved.
  if (viewer.kind !== "user") return false;

  const paste = await getPaste(viewer, id);
  return paste !== null && paste.owner === viewer.user.username;
}
