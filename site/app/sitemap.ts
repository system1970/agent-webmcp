import type { MetadataRoute } from "next";
import skillsFile from "../public/skills.json";

const BASE = "https://agent-webmcp.vercel.app";

function skillPaths(): string[] {
  const raw = skillsFile as unknown as { generated?: unknown; skills?: unknown };
  if (!Array.isArray(raw.skills)) return [];
  const out: string[] = [];
  for (const s of raw.skills) {
    if (
      typeof s === "object" &&
      s !== null &&
      typeof (s as Record<string, unknown>).path === "string"
    ) {
      out.push((s as unknown as { path: string }).path);
    }
  }
  return out.sort();
}

export default function sitemap(): MetadataRoute.Sitemap {
  const raw = skillsFile as unknown as { generated?: unknown };
  const stamp =
    typeof raw.generated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.generated)
      ? new Date(raw.generated + "T00:00:00Z")
      : new Date();
  return [
    { url: BASE, lastModified: stamp },
    { url: `${BASE}/skills`, lastModified: stamp },
    ...skillPaths().map((p) => ({
      url: `${BASE}/skills/${p}`,
      lastModified: stamp,
    })),
  ];
}
