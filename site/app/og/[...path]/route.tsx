import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import skillsFile from "../../../public/skills.json";

export const runtime = "nodejs";
export const contentType = "image/png";

const SANS =
  'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
const MONO =
  "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

type SkillLite = {
  path: string;
  title?: string;
  domain?: string;
  kind?: string;
  access?: string | null;
};

function findSkill(path: string): SkillLite | null {
  const raw = skillsFile as unknown as { skills?: unknown };
  if (!Array.isArray(raw.skills)) return null;
  for (const s of raw.skills) {
    if (
      typeof s === "object" &&
      s !== null &&
      (s as Record<string, unknown>).path === path
    ) {
      return s as SkillLite;
    }
  }
  return null;
}

let logoCache: string | null = null;
async function logo(): Promise<string> {
  if (!logoCache) {
    const buf = await readFile(
      join(process.cwd(), "public", "orkestrate-brand-mark.png")
    );
    logoCache = `data:image/png;base64,${buf.toString("base64")}`;
  }
  return logoCache;
}

function card(
  brand: string,
  top: string,
  title: string,
  sub: string,
  footLeft: string,
  footRight: string,
  fontSize: number
) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: "#060606",
        padding: 72,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            display: "flex",
            backgroundColor: "#ffffff",
            borderRadius: 12,
            padding: 6,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand} width={44} height={44} alt="" />
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 24,
            letterSpacing: 5,
            color: "#a1a1a1",
          }}
        >
          ORKESTRATE
        </div>
        <div style={{ fontSize: 24, color: "#525252" }}>/</div>
        <div style={{ fontFamily: MONO, fontSize: 24, color: "#e5e5e5" }}>
          agent-webmcp
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 22,
            color: "#a1a1a1",
            letterSpacing: 2,
            textTransform: "uppercase" as const,
          }}
        >
          {top}
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize,
            fontWeight: 700,
            lineHeight: 1.06,
            letterSpacing: "-0.025em",
            color: "#fafafa",
            maxWidth: 1000,
          }}
        >
          {title}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 23, color: "#737373" }}>
          {sub}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 23, color: "#e5e5e5" }}>
          {footLeft}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 22, color: "#737373" }}>
          {footRight}
        </div>
      </div>
    </div>
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segs = (await params).path ?? [];
  const rel = segs.join("/");

  // /og/skills/<domain>/<skill> (or /og/skills/mintlify)
  const src = await logo();
  if (segs[0] === "skills") {
    const skillPath = segs.slice(1).join("/");
    const s = findSkill(skillPath);
    const title = s?.title || skillPath || "agent-webmcp skill";
    const top = `${s?.kind || "toolset"} · ${s?.domain || ""}`.trim();
    const footLeft = s?.access === "login" ? "Login required" : "Public";
    return new ImageResponse(
      card(
        src,
        top,
        title,
        skillPath,
        footLeft,
        `agent-webmcp.vercel.app/skills/${skillPath}`,
        title.length > 30 ? 58 : 70
      ),
      { width: 1200, height: 630 }
    );
  }

  return new ImageResponse(
    card(
      src,
      "WEBMCP BROWSER CLI",
      "Turn the web into your agent's toolkit.",
      "$ npx skills add system1970/agent-webmcp",
      "Public · MIT",
      "agent-webmcp.vercel.app",
      72
    ),
    { width: 1200, height: 630 }
  );
}
