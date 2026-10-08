// Compile the CLI to a standalone binary. Versions are already generated
// into `src/generated/versions.ts` — this script only bundles.
// Usage: `bun ./scripts/compile.ts [outfile]` (default: `dist/agent-webmcp`).
export {}

const outfile = Bun.argv[2] ?? "dist/agent-webmcp"

const proc = Bun.spawnSync(["bun", "build", "--compile", "./src/main.ts", "--outfile", outfile])

process.exit(proc.exitCode ?? 1)
