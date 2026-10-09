// Gate: deterministic gate. Usage: `bun ./scripts/gate.ts`
// (or `bun run gate`). No browser, no network, no model. Eight checks,
// dense lines; failures accumulate and the run exits 1 so one invocation
// shows everything:
//
// 1. help-truth: no bare `1-300000` literal in src/ or skills/ (ceilings
//    interpolate from budgets.ts; SKILL.md cites the constants).
// 2. envelope-snapshot: local-only search returns {query, tools, skipped};
//    the execute description carries the full envelope contract.
// 3. untrusted-false: page data is always untrusted:true — never false.
// 4. `bun check` clean. 5. `bun test src` green.
// 6. desc-budget + schema-object: every tool blurb fits the budget
//    (detail lives in SKILL.md, never accretes into descriptions) and
//    every inputSchema is top-level {type:"object"} (one typeless tool
//    poisons the whole tools/list).
// 7. user-surface: strangers discover tools via SKILL and run on their
//    own machines — every registry tool documented, no my-machine paths.
// 8. registry-shape: one tool file, one registry line; the manifest
//    only imports, never defines (no registerTool call in it).
import { readdirSync, statSync } from "node:fs"
import { Effect } from "effect"

const root = `${import.meta.dir}/..`
let failed = false
const fail = (msg: string): void => {
  console.error(`FAIL ${msg}`)
  failed = true
}
const pass = (msg: string): void => console.log(`PASS ${msg}`)

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

// 1. help-truth.
{
  const hits = await scanTree("1-300000")
  if (hits.length > 0) fail(`help-truth: bare 1-300000 in ${hits.join(", ")} (interpolate the budgets.ts ceiling)`)
  else if (!failed) pass("help-truth")
}

// 2. envelope-snapshot.
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

// 3. untrusted-false: page data is always untrusted:true.
{
  const hits = [...(await scanTree("untrusted: false")), ...(await scanTree("untrusted:false"))]
  if (hits.length > 0) fail(`untrusted-false: page data is never untrusted:false: ${hits.join(", ")}`)
  else if (!failed) pass("untrusted-false")
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

// 6. desc-budget + schema-object: blurbs stay short (the catalog lives
// in SKILL.md); every inputSchema is top-level {type:"object"}
// (opencode rejects the WHOLE tools/list on one typeless tool — `status`
// shipped `anyOf` from an empty struct and poisoned all eight).
// Import-time only: registry side effects register, nothing dials.
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

// 7. user-surface: strangers discover tools via SKILL and run on their
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

// 8. registry-shape: one tool file, one registry line. Tool modules
// self-register (definition.registerTool); registry.ts only imports —
// a registerTool( call in the manifest fails this check.
{
  const names = readdirSync(`${root}/src/tools`)
    .filter((f) => f.endsWith(".ts") && f !== "registry.ts" && f !== "definition.ts" && !f.endsWith(".test.ts"))
    .map((f) => f.slice(0, -3))
  const manifest = await Bun.file(`${root}/src/tools/registry.ts`).text()
  const bad = names.filter(
    (n) => manifest.split("\n").filter((l) => l.trim() === `import "./${n}.ts"`).length !== 1
  )
  if (bad.length > 0) fail(`registry-shape: want exactly one import line per tool: ${bad.join(", ")}`)
  else if (manifest.includes("registerTool(")) fail("registry-shape: definitions live in tool files, never the manifest")
  else if (!failed) pass(`registry-shape (${names.length} tools)`)
}

if (failed) process.exit(1)
console.log("gate: green")
