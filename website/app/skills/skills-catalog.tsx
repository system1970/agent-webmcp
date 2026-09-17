"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface SkillTool {
  name: string;
  purpose: string;
  readonly: boolean;
  access: string | null;
}

export interface Skill {
  id: string;
  path: string;
  domain: string;
  skill: string;
  title: string;
  kind: string;
  description: string;
  site: string[];
  tags: string[];
  uses: string[];
  integration: string;
  tier: string;
  category: string;
  verified: string | null;
  updated: string | null;
  access: string | null;
  verbs: string[];
  tools: SkillTool[];
  examples: string[];
  guide: Array<{ title: string; items: string[] }>;
  validation: { verdict: string | null; date: string | null } | null;
  sha: string | null;
}

const FAVICON = (host: string) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function GlobeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M2 8h12M8 2c-3.5 3.2-3.5 8.8 0 12 3.5-3.2 3.5-8.8 0-12Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m10.5 10.5 3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SkillFavicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (!host || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-2"
      >
        <GlobeIcon />
      </span>
    );
  }
  return (
    <img
      src={FAVICON(host)}
      alt=""
      aria-hidden="true"
      width={24}
      height={24}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-6 w-6 shrink-0 object-contain"
    />
  );
}

const PAGE = 50;
type Sort = "name" | "updated";

function haystack(s: Skill): string {
  return (
    `${s.path} ${s.title} ${s.description} ${s.site.join(" ")} ` +
    `${s.verbs.join(" ")} ${s.tools.map((t) => `${t.name} ${t.purpose}`).join(" ")} ` +
    `${(s.tags ?? []).join(" ")} ${s.category} ${s.kind}`
  ).toLowerCase();
}

function matchingTools(s: Skill, tokens: string[]): SkillTool[] {
  if (tokens.length === 0) return [];
  return s.tools.filter((t) => {
    const hay = `${t.name} ${t.purpose}`.toLowerCase();
    return tokens.every((tok) => hay.includes(tok));
  });
}

export function SkillsCatalog({
  skills,
  generated,
}: {
  skills: Skill[];
  generated: string;
}) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [sort, setSort] = useState<Sort>("name");
  const searchRef = useRef<HTMLInputElement>(null);

  // Token-AND search: every word must appear somewhere in the haystack.
  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query]
  );
  const visible = useMemo(() => {
    const out = skills.filter((s) => {
      if (tokens.length === 0) return true;
      const hay = haystack(s);
      return tokens.every((t) => hay.includes(t));
    });
    out.sort((a, b) =>
      sort === "name"
        ? a.path.localeCompare(b.path)
        : (b.updated || "").localeCompare(a.updated || "") ||
          a.path.localeCompare(b.path)
    );
    return out;
  }, [skills, tokens, sort]);
  const searching = tokens.length > 0;

  // Paginate rows so the DOM stays small at 10 or 10,000 entries.
  useEffect(() => {
    setShown(PAGE);
  }, [tokens]);
  const page = visible.slice(0, shown);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <section aria-labelledby="skills-heading" className="shrink-0">
        <h1
          id="skills-heading"
          className="text-display font-heading max-[600px]:text-display-sm"
        >
          Skills
        </h1>
        <p className="mt-3 max-w-[64ch] text-lede text-ink-2">
          Give your agent a working understanding of the sites you use.
          One site. One skill. The knowledge and tools to work within it.
        </p>
      </section>

      <div className="relative mt-6 max-w-2xl shrink-0">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-2"
        >
          <SearchIcon />
        </span>
        <input
          ref={searchRef}
          id="skill-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sites, capabilities, or tools..."
          autoComplete="off"
          aria-label="Search skills"
          className="w-full rounded-md border border-line bg-canvas py-2.5 pl-9 pr-10 text-[15px] leading-6 text-ink placeholder:text-ink-2"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 font-mono text-xs leading-4 text-ink-2"
        >
          /
        </kbd>
      </div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p role="status" aria-live="polite" className="text-xs leading-4 text-ink-2">
          {searching
            ? `${visible.length} matching skill${visible.length === 1 ? "" : "s"}`
            : `${skills.length} skill${skills.length === 1 ? "" : "s"}`}
        </p>
        <label className="flex items-center gap-2 text-xs leading-4 text-ink-2">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink"
          >
            <option value="name">Name</option>
            <option value="updated">Recently updated</option>
          </select>
        </label>
      </div>

      <div className="mt-6 min-h-0 flex-1 overflow-auto pb-2">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-line bg-raised p-8 text-center">
            {skills.length === 0 ? (
              <>
                <p className="text-sm leading-5">
                  The catalog is being rebuilt.
                </p>
                <p className="mt-2 text-sm leading-5 text-ink-2">
                  New entries land here one by one, as each is crafted and
                  live-verified.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm leading-5">
                  No skills match
                  {query.trim() ? ` “${query.trim()}”` : ""}.
                </p>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="mt-3 inline-flex min-h-9 items-center justify-center rounded-md border border-line bg-canvas px-4 py-[7px] text-sm font-medium leading-5 no-underline transition-colors hover:bg-hover"
                >
                  Clear search
                </button>
              </>
            )}
          </div>
        ) : searching ? (
          <div className="flex flex-col gap-6">
            {page.map((s) => {
              const hits = matchingTools(s, tokens);
              const first = hits[0];
              return (
                <article key={s.id}>
                  <div className="flex items-baseline justify-between gap-4">
                    <a
                      href={`/skills/${s.path}`}
                      className="text-[15px] font-medium leading-6 text-ink no-underline hover:underline"
                    >
                      {s.title || s.path}
                    </a>
                    <span className="shrink-0 font-mono text-xs leading-4 text-ink-2">
                      {s.domain || s.site[0] || ""}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-ink-2">
                    {s.description}
                  </p>
                  {first ? (
                    <div className="mt-2 rounded-md border border-line bg-raised p-3">
                      <p className="text-meta uppercase text-ink-2">
                        Matching tool
                      </p>
                      <p className="mt-1 font-mono text-[13px] leading-5">
                        {first.name}
                      </p>
                      {first.purpose ? (
                        <p className="mt-0.5 text-sm leading-5 text-ink-2">
                          {first.purpose}
                        </p>
                      ) : null}
                      <p className="mt-2 flex gap-4 text-sm leading-5">
                        <a
                          href={`/skills/${s.path}#tool-${first.name}`}
                          className="no-underline hover:underline"
                        >
                          View matching tool →
                        </a>
                        <a
                          href={`/skills/${s.path}#tools`}
                          className="text-ink-2 no-underline hover:underline"
                        >
                          View all {s.tools.length} tools →
                        </a>
                      </p>
                    </div>
                  ) : null}
                  {hits.length > 1 ? (
                    <p className="mt-1 text-xs leading-4 text-ink-2">
                      Also matches:{" "}
                      {hits
                        .slice(1, 4)
                        .map((t) => t.name)
                        .join(", ")}
                      {hits.length > 4 ? ` (+${hits.length - 4} more)` : ""}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs leading-4 text-ink-2">
                <th scope="col" className="pb-3 pl-4 pr-6 font-medium">
                  Skill
                </th>
                <th scope="col" className="pb-3 pr-6 font-medium">
                  What it supports
                </th>
                <th scope="col" className="pb-3 pr-6 font-medium">
                  Tools
                </th>
                <th
                  scope="col"
                  className="hidden pb-3 pr-6 font-medium sm:table-cell"
                >
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {page.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-line-2 transition-colors hover:bg-hover"
                >
                  <td className="py-4 pl-4 pr-6">
                    <a
                      href={`/skills/${s.path}`}
                      className="flex items-center gap-3 no-underline"
                    >
                      <SkillFavicon host={s.site[0] ?? s.domain} />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium leading-6 text-ink hover:underline">
                          {s.title || s.path}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-xs leading-4 text-ink-2">
                          {s.domain || s.site[0] || s.path}
                        </span>
                      </span>
                    </a>
                  </td>
                  <td className="max-w-[48ch] py-4 pr-6 text-sm leading-5 text-ink-2">
                    <span className="line-clamp-2">{s.description}</span>
                  </td>
                  <td className="whitespace-nowrap py-4 pr-6">
                    <a
                      href={`/skills/${s.path}#tools`}
                      className="font-mono text-[13px] leading-5 text-ink-2 no-underline hover:underline"
                    >
                      {s.tools.length}
                    </a>
                  </td>
                  <td className="hidden whitespace-nowrap py-4 pr-6 text-sm leading-5 text-ink-2 sm:table-cell">
                    {fmtDate(s.updated)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {visible.length > page.length ? (
          <div className="mt-4 text-center">
            <p className="text-xs leading-4 text-ink-2">
              Showing {page.length} of {visible.length} — refine search to
              narrow
            </p>
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="mt-2 inline-flex min-h-9 items-center justify-center rounded-md border border-line bg-canvas px-4 py-[7px] text-sm font-medium leading-5 transition-colors hover:bg-hover"
            >
              Show more
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
