// Gate: deterministic pre-review gate. Usage: `bun ./scripts/gate.ts`
// (or `bun run gate`). No browser, no network, no model. Nine checks,
// dense lines; failures accumulate and the run exits 1 so one invocation
// shows everything:
//
// 1. ast-grep: sgconfig.yml rules self-test (valid/invalid snippets ride
//    with the rules; needs the binary — `bun run setup` installs it).
// 2. help-truth: no bare `1-300000` literal in src/ or skills/ (ceilings
//    interpolate from budgets.ts; SKILL.md cites the constants).
// 3. envelope-snapshot: local-only search returns {query, tools, skipped};
//    the execute description carries the full envelope contract.
// 4. `bun check` clean. 5. `bun test src` green.
// 6. `bun test scripts/review` green (the gate's own unit tests).
// 7. desc-budget + schema-object: every tool blurb fits the budget
//    (detail lives in SKILL.md, never accretes into descriptions) and
//    every inputSchema is top-level {type:"object"} (one typeless tool
//    poisons the whole tools/list).
// 8. user-surface: strangers discover tools via SKILL and run on their
//    own machines — every registry tool documented, no my-machine paths.
// 9. registry-shape: one tool file, one registry line (cross-file, so
//    native here — sgconfig only guards the manifest side).
import { readdirSync, statSync } from "node:fs"
import { Effect } from "effect"

const root = `${import.meta.dir}/..`
let failed = false
const fail = (msg: string): void => {
  console.error(`FAIL ${msg}`)
  failed = true
}
const pass = (msg: string): void => console.log(`PASS ${msg}`)

// 1. ast-grep: sgconfig.yml rules self-test (valid/invalid snippets ride
// with the rules, so they cannot rot). Needs the ast-grep binary —
// `bun run setup` installs it pinned+verified into ~/.local/bin.
{
  const homeBin = `${process.env.HOME}/.local/bin/ast-grep`
  const sg = Bun.which("ast-grep") ?? (await Bun.file(homeBin).exists() ? homeBin : null)
  if (sg === null) {
    fail("ast-grep: binary missing (run `bun run setup` for the pinned install)")
  } else {
    const proc = Bun.spawnSync([sg, "test", "-t", "sg-tests"], { cwd: root, stdout: "pipe", stderr: "pipe" })
    if ((proc.exitCode ?? 1) !== 0) {
      const out = new TextDecoder().decode(proc.stdout ?? new Uint8Array())
      const err = new TextDecoder().decode(proc.stderr ?? new Uint8Array())
      const tail = `${out}\n${err}`.trim().split("\n").slice(-5).join(" | ")
      fail(`ast-grep test: ${tail.slice(0, 300)}`)
    } else if (!failed) pass("ast-grep")
  }
}

// Worktree scan, never `git grep`: the pre-commit hook must see staged
// content, which tracked-blob grep cannot (a planted literal passed the
// hook 2026-10-09). Clean trees read identically, so CI/local match.
const scanTree = async (needle: string): Promise<Array<string>> => {
  const paths: Array<string> = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e.startsWith(".")) continue
      const p = `${dir}/${e}`
      if (statSync(p).isDirectory()) walk(p)
      else paths.push(p)
    }
  }
  walk(`${root}/src`)
  walk(`${root}/skills`)
  const hits: Array<string> = []
  for (const p of paths) {
    try {
      if ((await Bun.file(p).text()).includes(needle)) hits.push(p.replace(`${root}/`, ""))
    } catch {
      // Unreadable — skip; the check/test stages read the same tree.
    }
  }
  return hits
}

// 2. help-truth.
{
  const hits = await scanTree("1-300000")
  if (hits.length > 0) fail(`help-truth: bare 1-300000 in ${hits.join(", ")} (interpolate the budgets.ts ceiling)`)
  else if (!failed) pass("help-truth")
}

// 3. envelope-snapshot.
{
  const { search } = await import("../src/tools/search.ts")
  const result = await Effect.runPromise(search.execute({ query: "open" }) as Effect.Effect<{ content: string }>)
  let keys = ""
  try {
    const parsed = JSON.parse(result.content) as Record<string, unknown>
    keys = Object.keys(parsed).sort().join(",")
  } catch {
    keys = "(non-JSON)"
  }
  if (keys !== "query,skipped,tools") {
    fail(`envelope-snapshot: search keys are {${keys}}, want {query,skipped,tools}`)
  } else {
    const desc = await Bun.file(`${root}/src/tools/execute.ts`).text()
    if (!desc.includes("{value, spilled, toolCalls, perSession, origins, untrusted:true}")) {
      fail("envelope-snapshot: execute description lost the envelope contract")
    } else if (!failed) pass("envelope-snapshot")
  }
}

// 4. bun check.
{
  const proc = Bun.spawnSync(["bun", "check"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  if ((proc.exitCode ?? 1) !== 0) {
    const tail = new TextDecoder().decode(proc.stderr ?? proc.stdout ?? new Uint8Array()).trim().split("\n").slice(-3).join(" | ")
    fail(`bun check: ${tail.slice(0, 200)}`)
  } else if (!failed) pass("bun check")
}

// 5. bun test src.
{
  const proc = Bun.spawnSync(["bun", "test", "src"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  if ((proc.exitCode ?? 1) !== 0) {
    const tail = new TextDecoder().decode(proc.stderr ?? proc.stdout ?? new Uint8Array()).trim().split("\n").slice(-3).join(" | ")
    fail(`bun test src: ${tail.slice(0, 200)}`)
  } else if (!failed) pass("bun test src")
}

// 6. review harness tests (kept out of `bun test src`: tooling, not engine).
{
  const proc = Bun.spawnSync(["bun", "test", "scripts/review"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  if ((proc.exitCode ?? 1) !== 0) {
    const tail = new TextDecoder().decode(proc.stderr ?? proc.stdout ?? new Uint8Array()).trim().split("\n").slice(-3).join(" | ")
    fail(`bun test scripts/review: ${tail.slice(0, 200)}`)
  } else if (!failed) pass("bun test scripts/review")
}

// 7. desc-budget: tool blurbs stay short (L3 accretion class — the
// catalog lives in SKILL.md). 8. schema-object: every inputSchema is
// top-level {type:"object"} (opencode rejects the WHOLE tools/list on
// one typeless tool — `status` shipped `anyOf` from an empty struct and
// poisoned all eight). Import-time only: registry side effects
// register, nothing dials.
{
  await import("../src/tools/registry.ts")
  const { allTools } = await import("../src/tools/definition.ts")
  const DESC_BUDGET = 1500
  const fat = allTools
    .filter((t) => t.description.length > DESC_BUDGET)
    .map((t) => `${t.name} (${t.description.length})`)
  if (fat.length > 0) {
    fail(`desc-budget: over ${DESC_BUDGET} chars: ${fat.join(", ")} (move detail to SKILL.md)`)
  } else if (!failed) pass(`desc-budget (${allTools.length} tools)`)
  const badSchema = allTools
    .filter((t) => (t.inputSchema as { type?: unknown }).type !== "object")
    .map((t) => t.name)
  if (badSchema.length > 0) {
    fail(`schema-object: non-object inputSchema: ${badSchema.join(", ")} (MCP requires top-level type object)`)
  } else if (!failed) pass(`schema-object (${allTools.length} tools)`)
}

// 8. user-surface: strangers discover tools via SKILL and run on their
// own machines — every registry tool named there, no my-machine paths
// in shipped code. Import-time only (registers, never dials).
{
  await import("../src/tools/registry.ts")
  const { allTools } = await import("../src/tools/definition.ts")
  const skill = await Bun.file(`${root}/skills/agent-webmcp/SKILL.md`).text()
  // Anchor to backticked tool-record headings (`open { ...}`), never bare
  // substring: common-word names (open/list/close/...) all occur in prose.
  const undoc = allTools.map((t) => t.name).filter((n) => !skill.includes(`\`${n} {`))
  if (undoc.length > 0) {
    fail(`user-surface: tools missing a SKILL.md record entry: ${undoc.join(", ")}`)
  } else {
    const hits = await scanTree("home/pracurser")
    if (hits.length > 0) fail(`user-surface: my-machine paths in ${hits.join(", ")}`)
    else if (!failed) pass("user-surface")
  }
}

// 9. registry-shape: one tool file, one registry line. Tool modules
// self-register (definition.registerTool); registry.ts only imports
// (sg no-definitions-in-manifest guards the manifest side).
{
  const names = readdirSync(`${root}/src/tools`)
    .filter((f) => f.endsWith(".ts") && f !== "registry.ts" && f !== "definition.ts" && !f.endsWith(".test.ts"))
    .map((f) => f.slice(0, -3))
  const manifest = await Bun.file(`${root}/src/tools/registry.ts`).text()
  const bad = names.filter(
    (n) => manifest.split("\n").filter((l) => l.trim() === `import "./${n}.ts"`).length !== 1
  )
  if (bad.length > 0) fail(`registry-shape: want exactly one import line per tool: ${bad.join(", ")}`)
  else if (!failed) pass(`registry-shape (${names.length} tools)`)
}

if (failed) process.exit(1)
console.log("gate: green")
