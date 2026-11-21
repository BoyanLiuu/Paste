import { Suspense } from "react";

import Link from "next/link";

import { cookies } from "next/headers";

import { isGuestUsername } from "@/lib/guest-handle";
import { GUEST_COOKIE, guestPasteCount } from "@/lib/server/guest";
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
  bleed = false,
}: {
  current: "new" | "pastes" | "moderation" | null;
  children: React.ReactNode;
  /** Drop the centred container and its padding, for a surface that composes its own
   *  full-width regions. The landing page's section bands are hairline-ruled edge to edge
   *  and each one re-establishes the measured column inside itself; every other route
   *  wants that column once, here. */
  bleed?: boolean;
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
            <NavLink href="/new" active={current === "new"}>
              New paste
            </NavLink>
            {/* `fallback={null}` because this link is absent for a signed-out visitor
                anyway — a skeleton would flash a placeholder for something that may never
                arrive. */}
            <Suspense fallback={null}>
              <MyPastesLink active={current === "pastes"} />
            </Suspense>
            {/* The queue, for moderators only. It stayed omitted until M11 built
                /moderation, because a nav link that 404s on click is worse than an absent
                one — Next prefetches it on every page load, which puts a 404 in the
                console where it would mask a real error.

                Absent for everyone else, and that is presentation: the page itself calls
                `notFound()` for a non-moderator, which is what actually refuses. */}
            <Suspense fallback={null}>
              <ModerationLink active={current === "moderation"} />
            </Suspense>
          </nav>

          <div className="text-muted-foreground ml-auto text-sm">
            <Suspense fallback={<span className="opacity-0">Signed in</span>}>
              <AccountSlot />
            </Suspense>
          </div>
        </div>
      </header>

      {/* The claim offer, when a signed-in account arrives carrying a guest cookie (M16).
          Behind its own boundary like every other session-dependent slot, and `null` while
          it resolves — a banner that flashes in and out on every page load is worse than
          one that appears a beat late. */}
      <Suspense fallback={null}>
        <ClaimBanner />
      </Suspense>

      <main className={bleed ? "flex-1" : "container-page flex-1 py-10"}>
        {children}
      </main>
    </>
  );
}

/**
 * "You pasted something before signing in. Keep it?"
 *
 * THE RECEIPT PROMISES THIS, so something has to honour it. `create-receipt.tsx` tells a
 * guest to "sign in to keep it in yours" — and until M16 signing in did nothing at all,
 * which the user found by following the instruction the product gave them. A promise in the
 * copy with no mechanism behind it is the one thing this project's voice cannot afford.
 *
 * SHOWN RATHER THAN DONE, which is the whole design and is argued in `claim/route.ts`: one
 * browser can be two people, and nothing here is reversible.
 *
 * CHEAP WHEN IT DOES NOT APPLY, which matters because this renders on every route including
 * `/p/:id`. The cookie check is free and settles the overwhelmingly common cases — signed
 * out, or signed in with no guest history — before any query runs. Only the rare
 * just-signed-in-with-a-cookie state pays for a count.
 */
async function ClaimBanner() {
  const token = (await cookies()).get(GUEST_COOKIE)?.value;
  if (token === undefined || token === "") return null;

  const viewer = await getViewer();
  if (viewer.kind !== "user" || isGuestUsername(viewer.user.username)) {
    return null;
  }

  const count = await guestPasteCount(token);
  if (count === 0) return null;

  return (
    <div className="border-rule bg-brand-soft/25 border-b">
      <div className="container-page flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
        <p className="text-ink-2">
          You saved{" "}
          <span className="text-ink">
            {count} {count === 1 ? "paste" : "pastes"}
          </span>{" "}
          before signing in. Add {count === 1 ? "it" : "them"} to your account?
        </p>

        {/* TWO FORMS, NOT A FORM AND A LINK. Declining writes a cookie deletion, so it is
            a POST too — and a `<Link>` would be prefetched, which would decline on hover. */}
        <div className="flex items-center gap-2">
          <form method="post" action="/claim">
            <button
              type="submit"
              className="border-rule bg-card hover:border-rule-2 cursor-pointer rounded-md border px-3 py-1 transition-colors"
            >
              Add {count === 1 ? "it" : "them"}
            </button>
          </form>
          <form method="post" action="/claim?decline=1">
            <button
              type="submit"
              className="text-muted-foreground hover:text-ink cursor-pointer px-2 py-1 underline underline-offset-2"
            >
              No, leave {count === 1 ? "it" : "them"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** The queue, for moderators. 404 rather than 403 on the page itself, so the link's
 *  absence and the page's refusal agree about telling a prober nothing. */
async function ModerationLink({ active }: { active: boolean }) {
  const viewer = await getViewer();
  if (viewer.kind !== "user" || !viewer.user.isModerator) return null;

  return (
    <NavLink href="/moderation" active={active}>
      Removal requests
    </NavLink>
  );
}

/** The link to one's own pastes, which only exists for a signed-in visitor. */
async function MyPastesLink({ active }: { active: boolean }) {
  const viewer = await getViewer();
  if (viewer.kind !== "user") return null;

  // NOT FOR A GUEST (M15). `kind: "user"` is true of a guest — that is the whole design,
  // and it is why this slot showed them a "My pastes" link pointing at
  // `/list/guest-839bbe818b`, which reads as empty by deliberate construction. A nav link
  // to a page guaranteed to say "Nobody has saved anything under that name" is worse than
  // no link, and Next prefetches it on every page load.
  if (isGuestUsername(viewer.user.username)) return null;

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
 * Deliberately NOT Clerk's `<UserButton>`, and the same reasoning rules out
 * `<SignOutButton>`. Both are client components, and this header renders on EVERY route —
 * so either would load `clerk.browser.js` on `/p/:id`, a remote third-party script on the
 * one page whose job is rendering attacker-supplied text. §6.5 exists to prevent that, and
 * N11 budgets one client module on that route which `body-tools.tsx` already spends.
 *
 * SIGNING OUT IS A FORM POST, which is how it stays server-only. This comment used to say
 * "signing out is a link to Clerk's own page" and no such control existed for three
 * milestones: the header printed a username and offered no way out of the session.
 * `/sign-out` is a route handler, so there is nothing to import and no JavaScript involved;
 * it carries the reasoning for why the method is POST rather than GET.
 */
async function AccountSlot() {
  const viewer = await getViewer();

  // A GUEST IS PRESENTED AS SIGNED OUT, AND THIS WAS A BUG WORTH THE WHOLE COMMENT.
  //
  // Making a guest `kind: "user"` is what let the capability table, the owner joins and the
  // removal check stay untouched — and it also made every slot that asks "is there a user?"
  // answer yes. This one printed "Signed in as guest-839bbe818b | Sign out" in the chrome
  // of EVERY page, including `/p/:id`: so the handle that the breadcrumb, the metadata row,
  // the timeline and the tombstone were all carefully withholding was published in the
  // header above them, on every paste, to every reader. The fourth and worst place it
  // leaked, found by the user looking at the screen rather than by any test I had written.
  //
  // "Sign out" was wrong on its own terms too. There is no Clerk session to end, and the
  // guest cookie is the only claim this browser has on its own pastes — so a control
  // offering to clear it offers to orphan them, which §6.3 makes irreversible.
  //
  // Signed-out presentation is the honest answer: a guest has no account, and the thing
  // they can usefully do is get one.
  if (viewer.kind !== "user" || isGuestUsername(viewer.user.username)) {
    return (
      <Link href="/sign-in" className="hover:text-ink underline">
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span>
        Signed in as <span className="text-brand">{viewer.user.username}</span>
      </span>

      {/* A hairline separator rather than a border on the button: the account slot is two
          facts, not a control group. */}
      <span aria-hidden="true" className="bg-rule h-3.5 w-px" />

      <form method="post" action="/sign-out">
        {/* A SUBMIT BUTTON STYLED AS A LINK, which is the honest pairing. It reads like the
            "Sign in" link opposite it because it does the opposite thing, and it is a
            `<button>` because it performs an action rather than navigating — so a screen
            reader announces it correctly and a middle-click cannot open it in a tab.

            No `<Button>` primitive: every variant of it is a filled or bordered control,
            and a 14px chrome slot carrying a bordered button next to plain text reads as a
            dialog. */}
        <button
          type="submit"
          className="hover:text-ink cursor-pointer underline underline-offset-2"
        >
          Sign out
        </button>
      </form>
    </div>
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
