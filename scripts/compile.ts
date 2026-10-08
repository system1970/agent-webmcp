// Compile the CLI to a standalone binary with versions baked in.
// Reads versions from disk once, here, so the binary never has to.
// Usage: `bun ./scripts/compile.ts [outfile]` (default: `dist/agent-webmcp`).
export {}

const outfile = Bun.argv[2] ?? "dist/agent-webmcp"

const pkg = (await Bun.file("package.json").json()) as { version?: string }
const effectPkg = (await Bun.file("node_modules/effect/package.json").json()) as {
  version?: string
}

const proc = Bun.spawnSync([
  "bun",
  "build",
  "--compile",
  "./src/main.ts",
  "--outfile",
  outfile,
  "--define",
  `AGENT_WEBMCP_VERSION="${pkg.version ?? "0.0.0"}"`,
  "--define",
  `EFFECT_VERSION="${effectPkg.version ?? "unknown"}"`
])

process.exit(proc.exitCode ?? 1)
