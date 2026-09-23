import type { MetadataRoute } from "next";

const BASE = "https://agent-webmcp.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: new Date() },
    { url: `${BASE}/docs`, lastModified: new Date() },
    { url: `${BASE}/docs/installation`, lastModified: new Date() },
    { url: `${BASE}/docs/quick-start`, lastModified: new Date() },
    { url: `${BASE}/docs/commands`, lastModified: new Date() },
    { url: `${BASE}/docs/custom-tools`, lastModified: new Date() },
    { url: `${BASE}/docs/jev-loop`, lastModified: new Date() },
    { url: `${BASE}/docs/troubleshooting`, lastModified: new Date() },
  ];
}
