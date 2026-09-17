import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import skillsFile from "../../../public/skills.json";
import SiteNav from "../../site-nav";
import { CopyButton } from "../copy-button";
import type { Skill } from "../skills-catalog";

type Params = { slug: string[] };

function allSkills(): Skill[] {
  const raw = skillsFile as unknown as { skills?: unknown };
  if (!Array.isArray(raw.skills)) return [];
  return raw.skills.filter(
    (s): s is Skill =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as Record<string, unknown>).path === "string"
  );
}

export function generateStaticParams(): Params[] {
  return allSkills().map((s) => ({ slug: s.path.split("/") }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const path = slug.join("/");
  const s = allSkills().find((x) => x.path === path);
  if (!s) return { title: "Not found · agent-webmcp" };
  const title = `${s.title || s.path} · agent-webmcp`;
  const og = `/og/skills/${path}`;
  return {
    title,
    description: s.description,
    openGraph: {
      title,
      description: s.description,
      url: `/skills/${path}`,
      images: [
        { url: og, width: 1200, height: 630, alt: title },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: s.description,
      images: [og],
    },
  };
}

const GH = "https://github.com/system1970/agent-webmcp/blob/main/skills-catalog";

export default async function SkillPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const path = slug.join("/");
  const skills = allSkills();
  const s = skills.find((x) => x.path === path);
  if (!s) notFound();
  const tools = s.tools ?? [];
  const host = s.site[0] ?? s.domain;
  const inspect = `agent-webmcp tools add overlay.js --for ${host}`;

  return (
    <>
      <SiteNav current="/skills" />
      <div className="mx-auto w-full max-w-[680px] px-6 py-10">
        <p className="text-sm leading-5 text-ink-2">
          <Link href="/skills" className="no-underline hover:text-ink">
            ← All skills
          </Link>
        </p>

        <div className="mt-6 flex items-center gap-3">
          {host ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
              alt=""
              aria-hidden="true"
              width={28}
              height={28}
              loading="lazy"
              className="h-7 w-7 shrink-0 object-contain"
            />
          ) : null}
          <h1 className="text-display font-heading max-[600px]:text-display-sm">
            {s.title || s.path}
          </h1>
        </div>
        <p className="mt-3 max-w-[60ch] text-lede text-ink-2">{s.description}</p>

        <div className="mt-5 flex items-start justify-between gap-3 rounded-md border border-line bg-raised p-3">
          <code className="font-mono text-[13px] leading-5">{inspect}</code>
          <CopyButton text={inspect} label="Copy" />
        </div>

        {tools.length > 0 ? (
          <ul className="mt-6">
            {tools.map((t) => (
              <li
                key={t.name}
                className="border-t border-line-2 py-2.5 last:border-b"
              >
                <p className="font-mono text-[13px] leading-5">{t.name}</p>
                {t.purpose ? (
                  <p className="mt-0.5 text-sm leading-5 text-ink-2">
                    {t.purpose}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-8 border-t border-line-2 pt-4">
          <p className="text-meta uppercase text-ink-2">Source</p>
          <p className="mt-2 text-sm leading-5 text-ink-2">
            skills-catalog/{s.id}/ — SKILL.md · overlay.js · evals.json
          </p>
          <p className="mt-2 text-sm leading-5 text-ink-2">
            Download overlay.js from the folder, then run the command above
            (with the file path) to register its tools. Verify with
            `agent-webmcp list`.
          </p>
          <p className="mt-3 flex flex-wrap gap-2">
            <a
              href={`${GH}/${s.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-ink px-5 py-[7px] text-sm font-medium leading-5 text-canvas no-underline transition-opacity hover:opacity-85"
            >
              Open on GitHub
            </a>
          </p>
          <p className="mt-2 text-sm leading-5 text-ink-2">
            Broken verb? Open a PR against that folder.
          </p>
        </div>
      </div>
    </>
  );
}
