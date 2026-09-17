import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://agent-webmcp.vercel.app"),
  title: "agent-webmcp · ultra-light WebMCP browser CLI",
  description:
    "One static Go binary that discovers and invokes WebMCP tools in real Chrome sessions. ~15 ms cold start, ~39 ms round-trips, no daemon.",
  icons: {
    icon: "/orkestrate-brand-mark.png",
    apple: "/orkestrate-brand-mark.png",
  },
  openGraph: {
    title: "agent-webmcp · ultra-light WebMCP browser CLI",
    description:
      "One static Go binary that discovers and invokes WebMCP tools in real Chrome sessions. ~15 ms cold start, ~39 ms round-trips, no daemon.",
    url: "https://agent-webmcp.vercel.app",
    siteName: "agent-webmcp",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "agent-webmcp — turn the web into your agent's toolkit",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "agent-webmcp · ultra-light WebMCP browser CLI",
    description:
      "One static Go binary that discovers and invokes WebMCP tools in real Chrome sessions. ~15 ms cold start, ~39 ms round-trips, no daemon.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      {/* Natively styled site — tell Dark Reader to leave the DOM alone.
          Otherwise it injects data-darkreader-* attrs on <html> before
          hydration, causing React hydration-mismatch errors. (Rendered
          explicitly rather than via metadata.other, which drops empty
          values.) suppressHydrationWarning absorbs any other extension's
          one-time attribute injection on this element. */}
      <meta name="darkreader-lock" />
      <body>{children}</body>
    </html>
  );
}
