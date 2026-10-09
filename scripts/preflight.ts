// Preflight: deterministic pre-review gate. Usage:
// `bun ./scripts/preflight.ts` (check) or with `--write` (fix MAP hashes).
// No browser, no network, no model. Eight checks, dense lines; failures
// accumulate and the run exits 1 so one invocation shows everything:
//
// 1. map-sync: MAP.md Files-covered hashes equal sha256(file).slice(0,12).
// 2. help-truth: no bare `1-300000` literal in src/ or skills/ (ceilings
//    interpolate from budgets.ts; SKILL.md cites the constants).
// 3. envelope-snapshot: local-only search returns {query, tools, skipped};
//    the execute description carries the full envelope contract.
// 4. `bun check` clean. 5. `bun test src` green.
// 6. `bun test scripts/review` green (the gate's own unit tests).
// 7. desc-budget: every tool blurb fits the budget (detail lives in
//    SKILL.md, never accretes into descriptions).
// 8. user-surface: strangers discover tools via SKILL and run on their
//    own machines — every registry tool documented, no my-machine paths.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Effect } from "effect"

const root = `${import.meta.dir}/..`
const write = Bun.argv.includes("--write")
let failed = false
const fail = (msg: string): void => {
  console.error(`FAIL ${msg}`)
  failed = true
}
const pass = (msg: string): void => console.log(`PASS ${msg}`)

// 1. map-sync.
{
  const mapPath = `${root}/MAP.md`
  const lines = (await Bun.file(mapPath).text()).split("\n")
  const row = /^\| `([^`]+)` \| `([0-9a-f]+)` \|/
  let checked = 0
  const fixed: Array<string> = []
  const missing: Array<string> = []
  const dropped: Array<string> = []
  const next = lines.map((line) => {
    const m = row.exec(line)
    if (m === null) return line
    const [, rel, claimed] = m
    let bytes: Buffer
    try {
      bytes = readFileSync(`${root}/${rel}`)
    } catch {
      // The file is gone (moved or deleted): MAP rule 4 lets the row go,
      // but only --write performs the deletion so check mode stays loud.
      if (write) {
        dropped.push(rel)
        return null
      }
      missing.push(rel)
      return line
    }
    checked++
    const actual = createHash("sha256").update(bytes).digest("hex").slice(0, 12)
    if (actual !== claimed) {
      if (write) {
        fixed.push(rel)
        return line.replace(`\`${claimed}\``, `\`${actual}\``)
      }
      fail(`map-sync: ${rel} claims ${claimed}, file is ${actual} (run preflight --write)`)
    }
    return line
  })
  for (const rel of missing) fail(`map-sync: ${rel} listed in MAP.md but unreadable`)
  if (write && (fixed.length > 0 || dropped.length > 0)) {
    await Bun.write(mapPath, next.filter((l): l is string => l !== null).join("\n"))
    if (fixed.length > 0) console.log(`map-sync: rewrote ${fixed.length} hash(es): ${fixed.join(", ")}`)
    if (dropped.length > 0) console.log(`map-sync: dropped ${dropped.length} gone-file row(s): ${dropped.join(", ")}`)
  }
  if (!failed) pass(`map-sync (${checked} rows)`)
}

// 2. help-truth.
{
  const proc = Bun.spawnSync(["git", "grep", "-l", "1-300000", "--", "src", "skills"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const hits = new TextDecoder().decode(proc.stdout ?? new Uint8Array()).split("\n").map((l) => l.trim()).filter((l) => l !== "")
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
// catalog lives in SKILL.md). Import-time only: registry side effects
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
    const home = Bun.spawnSync(
      ["git", "grep", "-l", "home/pracurser", "--", "src", "skills"],
      { cwd: root, stdout: "pipe", stderr: "pipe" }
    )
    const hits = new TextDecoder().decode(home.stdout ?? new Uint8Array())
      .split("\n").map((l) => l.trim()).filter((l) => l !== "")
    if (hits.length > 0) fail(`user-surface: my-machine paths in ${hits.join(", ")}`)
    else if (!failed) pass("user-surface")
  }
}

if (failed) process.exit(1)
console.log("preflight: green")
