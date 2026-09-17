import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const alt =
  "agent-webmcp — turn the web into your agent's toolkit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SANS =
  'Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif';
const MONO =
  "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

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

export default async function Image() {
  const src = await logo();
  return new ImageResponse(
    (
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              backgroundColor: "#ffffff",
              borderRadius: 12,
              padding: 6,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} width={44} height={44} alt="" />
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
          <div
            style={{ fontFamily: MONO, fontSize: 24, color: "#e5e5e5" }}
          >
            agent-webmcp
          </div>
        </div>

        <div
          style={{
            fontFamily: SANS,
            fontSize: 82,
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: "-0.03em",
            color: "#fafafa",
            maxWidth: 1000,
          }}
        >
          Turn the web into your agent&apos;s toolkit.
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 23,
              color: "#e5e5e5",
              border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: 999,
              padding: "14px 26px",
            }}
          >
            $ npx skills add system1970/agent-webmcp
          </div>
          <div style={{ fontFamily: MONO, fontSize: 22, color: "#737373" }}>
            agent-webmcp.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
