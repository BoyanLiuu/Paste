import Link from "next/link";

import type { Viewer } from "@/lib/types";

// The header every screen carries. M4 adds the list-page nav state; M10 replaces the
// account slot with Clerk, which is why the signed-out branch already exists rather
// than being added alongside sign-in.

export function AppShell({
  viewer,
  current,
  children,
}: {
  viewer: Viewer;
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
            {/* The prototype's header also carries "My pastes" and the moderator
                queue. They are omitted until their routes exist — M4 and M11 — because
                a nav link that 404s on click is worse than an absent one, and Next
                prefetches it on every page load, which puts a 404 in the console where
                it would mask a real error. */}
          </nav>

          <div className="text-muted-foreground ml-auto text-sm">
            {viewer.kind === "user" ? (
              <>
                Signed in as{" "}
                <span className="text-brand">{viewer.user.username}</span>
              </>
            ) : (
              // M10 replaces this with Clerk's sign-in. Reads are public, so a
              // signed-out visitor is a first-class state, not an error.
              <span>Not signed in</span>
            )}
          </div>
        </div>
      </header>

      <main className="container-page flex-1 py-10">{children}</main>
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
