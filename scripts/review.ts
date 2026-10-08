// Send the working-tree diff to the standing code reviewer.
// Usage: `bun run review [--staged] [--runner pi|opencode]` (default: pi).
// Nothing to diff means nothing to review. Findings are report-only;
// BLOCKING findings must be addressed before committing. Vendored `repos/`
// is excluded: upstream code would flood the reviewer.
//
// Every run records itself to `reviews/YYYY-MM-DD-HHMM-<runner>.md`
// (gitignored, local only): header (time, runner, model, HEAD) + brief +
// diff + full reviewer output. Stdout still prints the verdict live; the
// file is the durable record for later questions ("what did the reviewer
// say about X?").
//
// Runner note: pi print mode needs model access, which nested/sandboxed
// sessions disable (403). An implicit pi run that hits the 403 falls back
// to the opencode code-reviewer subagent; any other pi failure, or a
// failure under an explicit `--runner pi`, is reported, not hidden.
// Both runners use model opencode-go/muse-spark-1.3-contributor.
export {}

const REVIEW_MODEL = process.env.CODEREVIEW_MODEL ?? "opencode-go/muse-spark-1.3-contributor"
// Auth resolves from process env at spawn (OPENCODE_API_KEY); never persist
// it. Pass values bare — wrapping the key in literal quotes breaks auth
// with 401s that look like an invalid key.

const stagedOnly = Bun.argv.includes("--staged")
const runnerIdx = Bun.argv.indexOf("--runner")
const runnerEq = Bun.argv.find((a) => a.startsWith("--runner="))?.split("=")[1]
const runnerNext = runnerIdx >= 0 ? Bun.argv[runnerIdx + 1] : undefined
const runnerExplicit = runnerEq ?? (runnerNext && !runnerNext.startsWith("-") ? runnerNext : undefined)
if (runnerExplicit !== undefined && runnerExplicit !== "pi" && runnerExplicit !== "opencode") {
  console.error(`unknown runner '${runnerExplicit}': expected pi or opencode`)
  process.exit(2)
}
const runner: "pi" | "opencode" = runnerExplicit === "opencode" ? "opencode" : "pi"
const diffArgs = stagedOnly ? ["diff", "--cached", "--"] : ["diff", "HEAD", "--"]

// New files are untracked, and `git diff HEAD` omits untracked content —
// the gate would review the MAP without the code it describes. Intent-to-add
// stages the file list without content, so the diff sees new files. Same
// exclusions as the diff itself.
const textOf = (out: Uint8Array | null): string => new TextDecoder().decode(out ?? new Uint8Array())

const others = textOf(
  Bun.spawnSync(["git", "ls-files", "--others", "--exclude-standard", "--", ".", ":!bun.lock", ":!repos"]).stdout
).split("\n").map((l) => l.trim()).filter((l) => l !== "")
if (!stagedOnly && others.length > 0) {
  Bun.spawnSync(["git", "add", "-N", "--", ...others])
  // The gate just wrote index state for a read-only review. Say so: the
  // content is untouched (intent-to-add stages the file list only), but
  // `git status` now lists these files as new.
  console.error(`review: intent-to-add ${others.length} new file(s) so the diff sees them (index file-list only, no content staged)`)
}

const diff = textOf(
  Bun.spawnSync(["git", ...diffArgs, ".", ":!bun.lock", ":!repos"]).stdout
)

const status = textOf(
  Bun.spawnSync(["git", "status", "--short", "--", ".", ":!repos"]).stdout
)
// Lockfile drift stays visible even though the diff hides lock content.
const lockStatus = textOf(
  Bun.spawnSync(["git", "status", "--short", "--", "bun.lock"]).stdout
)

if (diff.trim().length === 0) {
  console.log("nothing to review: working tree matches HEAD")
  process.exit(0)
}

const brief = [
  "You are the standing code reviewer for /home/pracurser/Projects/agent-webmcp",
  "(Bun + TypeScript + Effect v4 CLI: minimal engine exposing web pages as MCP tools).",
  "First read AGENTS.md and MAP.md at the repo root; they are law. Then review",
  "the attached working-tree diff on two axes: (1) Standards — effect-wrapped",
  "side effects, help-truth, least privilege, no stubs, mechanism-only comments;",
  "(2) Spec — no scope creep, no speculative machinery. Severity per finding:",
  "BLOCKING, SHOULD-FIX, NIT. Quote file:line for every finding. Keep it dense.",
  "Report only: do not edit, commit, or push.",
  "",
  "Context (git status):",
  status.trim() || "(clean status, diff vs HEAD)",
  lockStatus.trim() !== "" ? `Lockfile: ${lockStatus.trim()}` : "Lockfile: unchanged"
].join("\n")

const tmp = `${process.env.TMPDIR ?? "/tmp"}/agent-webmcp-review-${process.pid}-${Math.random().toString(36).slice(2)}.diff`
await Bun.write(tmp, diff)
Bun.spawnSync(["chmod", "600", tmp])

async function runPi(): Promise<{ ok: boolean; output: string; fallback403: boolean }> {
  // `@tmp` follows pi's documented `@path` contract (cli.md: file included
  // in the first prompt). Unverifiable from model-blocked sandboxes — if pi
  // ever ignores the attachment, the gate passes vacuous and this breaks loud.
  let proc
  try {
    proc = Bun.spawn(
      ["pi", "--print", "--model", REVIEW_MODEL, "--tools", "read,grep,find,ls", brief, `@${tmp}`],
      { stdout: "pipe", stderr: "pipe" }
    )
  } catch (error) {
    return { ok: false, output: `cannot start pi: ${String(error)}`, fallback403: false }
  }
  const [out, errText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  const code = await proc.exited
  const combined = `${out}\n${errText}`
  if (code === 0 && !/Model access is disabled/.test(combined)) {
    return { ok: true, output: out, fallback403: false }
  }
  if (/Model access is disabled/.test(combined)) return { ok: false, output: combined, fallback403: true }
  return { ok: false, output: combined || `pi exited ${code}`, fallback403: false }
}

async function runOpencode(): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(
    ["opencode", "run", "--agent", "code-reviewer", "--model", REVIEW_MODEL, "--auto", "--file", tmp, brief],
    { stdout: "pipe", stderr: "pipe" }
  )
  const [out, errText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  const code = await proc.exited ?? 1
  // Print live (same as before), but the record keeps everything.
  process.stdout.write(out)
  process.stderr.write(errText)
  await Bun.file(tmp).delete().catch(() => {})
  return { code, output: `${out}\n${errText}` }
}

// Durable record of this review. Local only (gitignored): timestamped so
// repeated runs never overwrite each other.
async function recordReview(runnerName: string, code: number, output: string): Promise<void> {
  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`
  const head = textOf(Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout).trim()
  const file = `reviews/${stamp}-${runnerName}.md`
  await Bun.write(file, [
    `# review ${stamp} (${runnerName}, exit ${code})`,
    ``,
    `- model: ${REVIEW_MODEL}`,
    `- HEAD: ${head}${stagedOnly ? " (staged diff)" : ""}`,
    ``,
    `## brief`,
    ``,
    brief,
    ``,
    `## diff`,
    ``,
    "```diff",
    diff,
    "```",
    ``,
    `## reviewer output`,
    ``,
    output.trim() || "(no output)"
  ].join("\n"))
  console.error(`review: recorded to ${file}`)
}

if (runner === "pi") {
  const result = await runPi()
  if (result.ok) {
    await Bun.file(tmp).delete().catch(() => {})
    console.log("reviewer: pi")
    console.log(result.output)
    await recordReview("pi", 0, `reviewer: pi\n\n${result.output}`)
    process.exit(0)
  }
  if (result.fallback403 && runnerExplicit === undefined) {
    console.error("reviewer: pi unavailable (nested model access disabled) — falling back to opencode")
    const fallback = await runOpencode()
    await recordReview("opencode-fallback", fallback.code, fallback.output)
    process.exit(fallback.code)
  }
  await Bun.file(tmp).delete().catch(() => {})
  console.error(`reviewer: pi failed:\n${result.output.slice(0, 2000)}`)
  await recordReview("pi-failed", 1, result.output)
  process.exit(1)
}

const final = await runOpencode()
await recordReview("opencode", final.code, final.output)
process.exit(final.code)
