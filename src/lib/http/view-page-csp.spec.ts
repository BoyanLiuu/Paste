import { describe, expect, it } from "vitest";

import {
  clerkCsp,
  clerkFrontendOrigin,
  RAW_CSP,
  viewCsp,
} from "@/lib/http/csp";

// The global-policy mistake (ARCHITECTURE §6.5).
//
// One CSP written to satisfy Clerk is the single change that would undo this section. Clerk
// needs a remote script origin and `'unsafe-inline'` styles; the view page renders
// attacker-supplied text as its entire purpose. A policy that works for both is the loose
// one, applied to the page that needed the strict one.
//
// This came within one file of happening. `clerk init` put `ClerkProvider` in the ROOT
// layout, and measured on the running server, `/p/:id` then loaded
// `clerk.browser.js` from a remote `clerk.accounts.dev` origin — blocked by the view CSP,
// so Clerk was broken there too. The provider now lives in a layout covering only
// `/sign-in` and `/sign-up`, and these assertions are what stop it drifting back.

describe("the view page's policy", () => {
  const csp = viewCsp("test-nonce");

  it("allows no remote script origin at all", () => {
    // Not "no Clerk origin" — no remote origin of any kind. Naming Clerk specifically
    // would pass a policy that had let some other CDN in.
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc).toBe("script-src 'self' 'nonce-test-nonce'");
    expect(scriptSrc).not.toMatch(/https?:/);
  });

  it("carries no 'unsafe-inline' anywhere", () => {
    // Styles included. `style-src 'self'` is only achievable because the renderer moves
    // Shiki's per-token styles into generated classes — the CSS-variables theme alone does
    // not do it, which three revisions of the architecture got wrong.
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("style-src 'self'");
  });

  it("mentions no Clerk origin", () => {
    expect(csp).not.toMatch(/clerk/i);
    expect(csp).not.toContain("accounts.dev");
  });

  it("defaults to nothing and forbids framing", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("uses the nonce it was given, so each response differs", () => {
    // A reused nonce is not a nonce. The proxy mints one per request; this is the half
    // that proves the value reaches the header.
    expect(viewCsp("abc")).toContain("'nonce-abc'");
    expect(viewCsp("xyz")).not.toContain("'nonce-abc'");
  });
});

describe("the Clerk pages' policy", () => {
  const csp = clerkCsp();

  it("is a different policy, not the view policy with additions", () => {
    expect(csp).not.toBe(viewCsp("n"));
    // It has no nonce: Clerk's own script is allowed by origin, and inventing a nonce here
    // would imply the sign-in page streams Suspense content the way the view page does.
    expect(csp).not.toContain("nonce-");
  });

  it("permits inline styles, which is exactly why it is separate", () => {
    // Clerk's components inject styles. This is the concession the view page must never
    // inherit, and the reason these are two values rather than one with exceptions.
    expect(csp).toContain("'unsafe-inline'");
  });

  it("still denies by default and forbids framing", () => {
    // Looser than the view page is not the same as permissive. A sign-in form is worth
    // protecting too — it is where credentials are typed.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows the instance's own origin when the key is set", () => {
    const origin = clerkFrontendOrigin();
    if (origin === null) {
      // Unset or unparseable key: fall back to the strict `'self'` rather than a wildcard.
      // A broken sign-in page is a visible failure; a permissive script-src is not.
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toMatch(/script-src[^;]*https?:/);
      return;
    }

    expect(csp).toContain(`script-src 'self' ${origin}`);
    expect(origin).toMatch(/^https:\/\//);
  });

  it("names no wildcard host", () => {
    // `https://*.clerk.accounts.dev` would cover every tenant on the shared development
    // domain, not just ours. The origin is derived from the publishable key for that
    // reason — and because hardcoding a development instance breaks on the first deploy,
    // with Clerk's own script blocked by our own header.
    expect(csp).not.toContain("*.");
  });
});

describe("the raw origin's policy", () => {
  it("is a bare sandbox", () => {
    // No allow-list at all, so the response has no origin privileges — defence in depth
    // for the case where content-type handling fails, which is the failure this endpoint's
    // separate domain exists for.
    expect(RAW_CSP).toBe("sandbox");
  });
});

describe("clerkFrontendOrigin", () => {
  const withKey = <T>(key: string | undefined, body: () => T): T => {
    const previous = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    if (key === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = key;
    try {
      return body();
    } finally {
      if (previous === undefined)
        delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = previous;
    }
  };

  it("decodes the host out of a publishable key", () => {
    // The key is `pk_(test|live)_<base64 host>$`. Decoding it is what makes development
    // and production instances work from one code path.
    const encoded = Buffer.from("example-123.clerk.accounts.dev$").toString(
      "base64",
    );
    expect(withKey(`pk_test_${encoded}`, clerkFrontendOrigin)).toBe(
      "https://example-123.clerk.accounts.dev",
    );
    expect(withKey(`pk_live_${encoded}`, clerkFrontendOrigin)).toBe(
      "https://example-123.clerk.accounts.dev",
    );
  });

  it("returns null rather than guessing", () => {
    // Every one of these would otherwise become a host in a security header.
    expect(withKey(undefined, clerkFrontendOrigin)).toBeNull();
    expect(withKey("", clerkFrontendOrigin)).toBeNull();
    expect(withKey("not-a-key", clerkFrontendOrigin)).toBeNull();
    expect(
      withKey(
        `pk_test_${Buffer.from("no-dot$").toString("base64")}`,
        clerkFrontendOrigin,
      ),
    ).toBeNull();
  });

  it("refuses a decoded value that is not a bare hostname", () => {
    // The decoded bytes end up inside a CSP directive, so anything with a space, a
    // semicolon or a scheme in it could append a directive of its own.
    for (const hostile of [
      "evil.com; script-src *",
      "evil.com 'unsafe-inline'",
      "https://evil.com",
      "evil.com/path",
    ]) {
      const key = `pk_test_${Buffer.from(`${hostile}$`).toString("base64")}`;
      expect(withKey(key, clerkFrontendOrigin), hostile).toBeNull();
    }
  });
});
