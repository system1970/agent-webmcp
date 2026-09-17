import type { Metadata } from "next";
import skillsFile from "../../public/skills.json";
import Brand from "../brand";
import SiteNav from "../site-nav";
import { SkillsCatalog, type Skill } from "./skills-catalog";

export const metadata: Metadata = {
  title: "Explore capabilities · agent-webmcp",
  description:
    "Discover tools and reusable skills for the software you use. Search a product, website, tool, or task.",
  openGraph: {
    title: "Explore capabilities · agent-webmcp",
    description:
      "Discover tools and reusable skills for the software you use. Search a product, website, tool, or task.",
    url: "/skills",
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
    title: "Explore capabilities · agent-webmcp",
    description:
      "Discover tools and reusable skills for the software you use. Search a product, website, tool, or task.",
    images: ["/opengraph-image"],
  },
};

const DIRECTORY = "https://webmcp.com";

function isSkill(v: unknown): v is Skill {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  const strArr = (x: unknown) => Array.isArray(x) && (x as unknown[]).every((h) => typeof h === "string");
  return (
    typeof s.id === "string" &&
    typeof s.path === "string" &&
    typeof s.description === "string" &&
    strArr(s.site) &&
    strArr(s.verbs) &&
    typeof s.kind === "string" &&
    typeof s.tier === "string" &&
    typeof s.category === "string" &&
    (typeof s.verified === "string" || s.verified === null) &&
    (typeof s.sha === "string" || s.sha === null)
  );
}

export default function SkillsPage() {
  const raw = skillsFile as unknown as { generated?: unknown; skills?: unknown };
  const skills: Skill[] = Array.isArray(raw.skills)
    ? raw.skills.filter(isSkill)
    : [];
  const generated = typeof raw.generated === "string" ? raw.generated : "";

  return (
    <>
      <a
        href="#main"
        className="absolute -left-[9999px] top-0 z-10 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink no-underline focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteNav current="/skills" />
      <div className="mx-auto flex h-[calc(100svh-4rem)] w-full max-w-[1440px] flex-col overflow-hidden px-6">
        <main id="main" className="flex min-h-0 flex-1 flex-col py-6">
          <SkillsCatalog skills={skills} generated={generated} />
        </main>
      </div>
    </>
  );
}
