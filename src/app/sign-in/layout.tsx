import { ClerkProvider } from "@clerk/nextjs";

// The provider lives here rather than in the root layout.
//
// `ClerkProvider` loads `clerk.browser.js` from the instance's own origin, so wherever it
// renders, that origin has to be allowed by the page's CSP. Putting it at the root meant
// the view page — the strictest policy in the product, on the page that renders hostile
// text — pulled a remote third-party script (§6.5). Scoping it to the routes that render
// Clerk's own components keeps `script-src 'self'` intact everywhere else.
//
// Server-side `auth()` needs no provider, which is why the rest of the app does not miss
// it: `AppShell` prints the signed-in username as text from `getViewer()`.

export default function ClerkUiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClerkProvider>{children}</ClerkProvider>;
}
