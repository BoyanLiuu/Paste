import type { Metadata } from "next";
import { Host_Grotesk, Atkinson_Hyperlegible_Mono } from "next/font/google";
import "./globals.css";

// next/font downloads and self-hosts these at build time, so the browser makes no
// font-CDN request. That matters beyond the workspace rule: the view page's CSP is
// `default-src 'none'` (ARCHITECTURE §6.5), which would block a CDN outright.
const display = Host_Grotesk({
  variable: "--font-host-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const mono = Atkinson_Hyperlegible_Mono({
  variable: "--font-atkinson-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Paste — paste once, the link keeps answering",
  description:
    "Share a snippet at a URL that still answers later: immutable text, chosen retention, and secrets caught before they are addressable.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} h-full antialiased`}
    >
      {/* No ClerkProvider here, deliberately.

          `clerk init` put one in this layout, which wraps every route — and measured on
          the running server, that made /p/:id load
          `clerk.browser.js` from a remote clerk.accounts.dev origin. A third-party script
          on the one page whose job is to render attacker-supplied text is the exact
          mistake §6.5 exists to prevent, and the view page's CSP (`script-src 'self'`)
          blocks it, so the provider was broken there as well as unwanted.
          `AppShell` is a Server Component that prints the username as text, and `auth()`
          works server-side without a provider, so nothing outside the Clerk UI pages
          needs one. The two that do have their own layout. */}
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
