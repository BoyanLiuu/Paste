import { Suspense } from "react";

import Link from "next/link";

import { getViewer } from "@/lib/server/session";

// The header every screen carries.
//
// IT NO LONGER TAKES A VIEWER, and that is a `cacheComponents` requirement rather than a
// style preference. Resolving the viewer means calling Clerk's `auth()`, which reads the
// request — and under `cacheComponents` a request read outside a Suspense boundary fails
// the build. Every page used to resolve the viewer in its body purely to hand it to this
// component, so after M10 wired Clerk the production build broke on `/` with "uncached or
// runtime data during prerendering".
//
// The two slots that actually need a session resolve it themselves, each behind its own
// boundary. The rest of the chrome — wordmark, "New paste", the layout — is static and
// prerenders, which is also the better result: the header paints immediately and only the
// account state streams in.

export function AppShell({
  current,
  children,
}: {
  current: "new" | "pastes" | "moderation" | null;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="border-rule border-b">
        <div className="container-page flex h-14 items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <Wordmark />
            Paste
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <NavLink href="/" active={current === "new"}>
              New paste
            </NavLink>
            {/* `fallback={null}` because this link is absent for a signed-out visitor
                anyway — a skeleton would flash a placeholder for something that may never
                arrive. */}
            <Suspense fallback={null}>
              <MyPastesLink active={current === "pastes"} />
            </Suspense>
            {/* The moderator queue stays omitted until M11 builds /moderation. A nav
                link that 404s on click is worse than an absent one, and Next
                prefetches it on every page load, which puts a 404 in the console
                where it would mask a real error. */}
          </nav>

          <div className="text-muted-foreground ml-auto text-sm">
            <Suspense fallback={<span className="opacity-0">Signed in</span>}>
              <AccountSlot />
            </Suspense>
          </div>
        </div>
      </header>

      <main className="container-page flex-1 py-10">{children}</main>
    </>
  );
}

/** The link to one's own pastes, which only exists for a signed-in visitor. */
async function MyPastesLink({ active }: { active: boolean }) {
  const viewer = await getViewer();
  if (viewer.kind !== "user") return null;

  return (
    <NavLink href={`/list/${viewer.user.username}`} active={active}>
      My pastes
    </NavLink>
  );
}

/**
 * Who is signed in, or an invitation to sign in.
 *
 * A signed-out visitor is a first-class state and not an error: reads are public (§3), so
 * most people who ever see this header will see the signed-out version of it.
 *
 * Deliberately NOT Clerk's `<UserButton>`. That is a client component, and it would load
 * `clerk.browser.js` on every page including the view page — a remote third-party script
 * on the one page that renders attacker-supplied text, which §6.5 exists to prevent. The
 * username is plain server-rendered text, and signing out is a link to Clerk's own page.
 */
async function AccountSlot() {
  const viewer = await getViewer();

  if (viewer.kind !== "user") {
    return (
      <Link href="/sign-in" className="hover:text-ink underline">
        Sign in
      </Link>
    );
  }

  return (
    <>
      Signed in as <span className="text-brand">{viewer.user.username}</span>
    </>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "border-rule bg-card rounded-md border px-3 py-1.5"
          : "text-muted-foreground hover:text-ink rounded-md px-3 py-1.5 transition-colors"
      }
    >
      {children}
    </Link>
  );
}

function Wordmark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path
        d="M4 8.5h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="7" cy="15.5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="15.5" r="1.6" fill="currentColor" />
      <circle cx="17" cy="15.5" r="1.6" fill="currentColor" />
    </svg>
  );
}
