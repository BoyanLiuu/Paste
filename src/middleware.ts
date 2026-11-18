import { NextResponse, type NextRequest } from "next/server";

import { viewCsp } from "@/lib/http/csp";

// Sets the view page's Content-Security-Policy, with a per-request nonce.
//
// Middleware rather than next.config's headers(), because the nonce has to change per
// request and a static header cannot. Next reads the nonce from the `script-src`
// directive on the request's CSP header and stamps it onto its own inline scripts —
// including the ones React streaming uses to relocate resolved Suspense content, which
// a bare `script-src 'self'` blocks outright (lib/http/csp.ts explains the failure).
//
// Scoped to /p/* on purpose. M10 adds a separate, looser entry for the pages rendering
// Clerk components. A single global policy would have to satisfy Clerk, which means
// loosening the one page that renders attacker-supplied text — the thing §6.5 exists
// to prevent.

export const config = {
  matcher: ["/p/:path*"],
};

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const csp = viewCsp(nonce);

  // Next looks for the nonce here, on the *request*, to apply it to its own scripts.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}
