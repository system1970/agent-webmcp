// Send the working-tree diff to the standing code-reviewer subagent.
// Usage: `bun run review [--staged]`. Nothing to diff means nothing to review.
// The reviewer is report-only (edit denied in its permissions); BLOCKING
// findings must be addressed before committing.
export {}

const stagedOnly = Bun.argv.includes("--staged")
const diffArgs = stagedOnly ? ["diff", "--cached", "--"] : ["diff", "HEAD", "--"]

const diff = await new Response(
  Bun.spawnSync(["git", ...diffArgs, ".", ":!bun.lock"]).stdout
).text()

const status = await new Response(Bun.spawnSync(["git", "status", "--short"]).stdout).text()

if (diff.trim().length === 0) {
  console.log("nothing to review: working tree matches HEAD")
  process.exit(0)
}

const prompt = [
  "Review the attached working-tree diff for /home/pracurser/Projects/agent-webmcp.",
  "Context (git status):",
  status.trim() || "(clean status, diff vs HEAD)",
  "Read AGENTS.md and MAP.md at the repo root first; they are law.",
  "Report BLOCKING / SHOULD-FIX / NIT with file:line for every finding. Report only."
].join("\n")

const model = process.env.CODEREVIEW_MODEL ?? "opencode-go/muse-spark-1.3-contributor"
const tmp = `${process.env.TMPDIR ?? "/tmp"}/agent-webmcp-review-${process.pid}-${Math.random().toString(36).slice(2)}.diff`
await Bun.write(tmp, diff)

const proc = Bun.spawn(
  [
    "opencode",
    "run",
    "--agent",
    "code-reviewer",
    "--model",
    model,
    "--auto",
    "--file",
    tmp,
    prompt
  ],
  { stdout: "inherit", stderr: "inherit" }
)

const code = await proc.exited
await Bun.file(tmp).delete().catch(() => {})
process.exit(code ?? 1)
