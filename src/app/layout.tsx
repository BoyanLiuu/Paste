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
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
