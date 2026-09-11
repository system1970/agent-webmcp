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
  title: "agent-webmcp · ultra-light WebMCP browser CLI",
  description:
    "One static Go binary that discovers and invokes WebMCP tools in real Chrome sessions. ~15 ms cold start, ~39 ms round-trips, no daemon.",
  openGraph: {
    title: "agent-webmcp · ultra-light WebMCP browser CLI",
    description:
      "One static Go binary that discovers and invokes WebMCP tools in real Chrome sessions. ~15 ms cold start, ~39 ms round-trips, no daemon.",
    url: "https://agent-webmcp.vercel.app",
    siteName: "agent-webmcp",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
