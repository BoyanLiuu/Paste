import { SignUp } from "@clerk/nextjs";
import { connection } from "next/server";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";

// A DYNAMIC HOLE, and it is a CSP requirement rather than a data one.
//
// This page needs no request data, so Next prerendered the whole document — and a
// prerendered document's inline scripts are written at BUILD time, when no per-request
// nonce exists. The proxy puts `script-src 'self' 'nonce-…'` on this route, so Next's own
// bootstrap scripts were refused and the page was BLANK on a hard load. Measured: 6 inline
// scripts, 0 carrying a nonce, 6 refused, and every one of them Next's own —
// `__NEXT_CLIENT_RESUME`, `$RT`, `$RX`, TURBOPACK, `__next_f`.
//
// Next stamps the nonce only onto HTML it renders AT REQUEST TIME. `/p/:id` works for that
// reason and no other: it has a real dynamic hole, so 14 of its 15 inline scripts are
// stamped. This page had none, so nothing was. §6.5 states the rule.
//
// `connection()` has to sit INSIDE the Suspense boundary. In the page body it fails the
// build under `cacheComponents` ("accessed outside of <Suspense> prevents the route from
// being prerendered"), and `export const instant = false` — which that error also suggests
// — changed nothing, because a route with no dynamic access has nothing to block on and
// Next prerenders it anyway. The route stayed `◐`.
//
// TWO THINGS HID IT. Reaching the page by clicking "Sign in" works, because that document
// came from `/`, which carries no policy, so the header on this response never applied.
// And a status probe cannot see it: a blank document is a 200.

export default function SignUpPage() {
  // INSIDE THE APP SHELL, so there is a way back. This was a bare centred card on an
  // otherwise empty document — no wordmark, no nav, nothing to click — which made signing
  // in a one-way door: a visitor who arrived and changed their mind had the browser's back
  // button and nothing else. Same header as every other route.
  //
  // `current={null}` because this is not one of the nav destinations.
  return (
    <AppShell current={null}>
      <div className="flex items-center justify-center py-10">
        <Suspense fallback={<Loading />}>
          <Form />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function Form() {
  await connection();
  return <SignUp />;
}

function Loading() {
  // Clerk's card is client-rendered and sized by its own styles, so this reserves roughly
  // its footprint rather than guessing at its shape.
  return (
    <div
      role="status"
      aria-label="Loading the form"
      className="border-rule h-[28rem] w-[25rem] animate-pulse rounded-xl border"
    />
  );
}
