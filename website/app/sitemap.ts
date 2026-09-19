import type { MetadataRoute } from "next";

const BASE = "https://agent-webmcp.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, lastModified: new Date() },
  ];
}
