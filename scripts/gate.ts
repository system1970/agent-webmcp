// Gate: deterministic checks. No browser, no network, no model.
// Failures accumulate; exit 1 shows everything at once.
import { Effect } from "effect"
import { allTools } from "../src/tools/registry.ts"

let failed = false
const fail = (msg: string): void => {
  console.error(`FAIL ${msg}`)
  failed = true
}
const pass = (msg: string): void => console.log(`PASS ${msg}`)

// bun check (tsgo diagnostics included: floating effects fail here).
{
  const proc = Bun.spawnSync(["bun", "check"], { stdout: "pipe", stderr: "pipe" })
  if ((proc.exitCode ?? 1) !== 0) fail("bun check: type errors (see above)")
  else pass("bun check")
}

// bun test src.
{
  const proc = Bun.spawnSync(["bun", "test", "src"], { stdout: "pipe", stderr: "pipe" })
  if ((proc.exitCode ?? 1) !== 0) fail("bun test src: failing tests (see above)")
  else pass("bun test src")
}

// gen: generated versions must match package.json.
{
  const proc = Bun.spawnSync(["bun", "./scripts/gen-versions.ts", "--check"], { stdout: "pipe", stderr: "pipe" })
  if ((proc.exitCode ?? 1) !== 0) fail("gen: src/generated/versions.ts is stale (run `bun run gen`)")
  else pass("gen")
}

// schema-object: every inputSchema is top-level {type:"object"} — one
// typeless tool poisons the whole MCP tools/list. Import-time only.
{
  await import("../src/tools/registry.ts")
  const bad = allTools
    .filter((t) => (t.inputSchema as { type?: unknown }).type !== "object")
    .map((t) => t.name)
  if (bad.length > 0) fail(`schema-object: non-object inputSchema: ${bad.join(", ")}`)
  else pass(`schema-object (${allTools.length} tools)`)
}

// desc-budget: blurbs stay short, detail lives in SKILL.md.
{
  const fat = allTools.filter((t) => t.description.length > 1500).map((t) => t.name)
  if (fat.length > 0) fail(`desc-budget: over 1500 chars: ${fat.join(", ")}`)
  else pass("desc-budget")
}

if (failed) process.exit(1)
console.log("gate: green")
