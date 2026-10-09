// Send the working-tree diff to the standing code reviewer.
// Usage: `bun run review [--staged] [--runner pi|opencode] [--plan FILE] [--dry-run] [--verify]`
// Nothing to diff means nothing to review.
//
// Tiers by diff size (Cloudflare risk-tier shape, our lines): trivial
// (<=10 non-hot lines) skips the model — `bun run gate` governs those.
// Everything else gets one reviewer pass (lite <=400, full above or hot
// path — the label signals size, not a second pass). `--verify` opts into
// a verifier pass that reads each BLOCKING's file:line and kills the
// unverified (off by default: two self-reviews spent it for zero kills).
//
// Fail-closed: a runner failure records and exits 1 (a gate that cannot
// confirm the review never reports green — dry-run included). Confirmed
// BLOCKING > 0 exits 1; --dry-run records but always exits 0 on a completed
// review. Same-sha reruns hit the patch cache in reviews/ and exit in
// seconds. Findings are report-only; BLOCKING must be addressed before
// committing.
//
// Layout (one module per job, each unit-tested): git plumbing in
// `review/git.ts`, brief assembly in `review/brief.ts`, patch cache in
// `review/cache.ts`, verdict parsing in `review/verdict.ts`, model runners
// in `review/runners.ts`, records in `review/record.ts`. Vendored `repos/`
// plus build output (`dist/`) and past records (`reviews/`) are excluded:
// upstream code and local noise would flood the reviewer.
//
// Every run records itself to `reviews/YYYY-MM-DD-HHMM-<runner>.md`
// (gitignored, local only). Stdout still prints the verdict live; the file
// is the durable record for later questions ("what did the reviewer say
// about X?").
//
// Runner note: pi print mode needs model access, which nested/sandboxed
// sessions disable (403). An implicit pi run that hits the 403 falls back
// to the opencode code-reviewer subagent; any other pi failure, or a
// failure under an explicit `--runner pi`, is reported, not hidden.
// Both runners use model opencode-go/muse-spark-1.3-contributor.
import { sha12, cacheKey, stamp, readCache, writeCache } from "./review/cache.ts"
import {
  stageIntentToAdd, loadWorkingDiff, loadNumstat, parseNumstat,
  computeTier, shortHead
} from "./review/git.ts"
import { buildBrief, loadPlan, loadMemory, VERIFY_BRIEF } from "./review/brief.ts"
import { dispatch, type Runner } from "./review/runners.ts"
import { recordReview } from "./review/record.ts"
import { parseVerdict, gateRed } from "./review/verdict.ts"

const stagedOnly = Bun.argv.includes("--staged")
const dryRun = Bun.argv.includes("--dry-run")
const wantVerify = Bun.argv.includes("--verify")
const runnerIdx = Bun.argv.indexOf("--runner")
const runnerEq = Bun.argv.find((a) => a.startsWith("--runner="))?.split("=")[1]
const runnerNext = runnerIdx >= 0 ? Bun.argv[runnerIdx + 1] : undefined
const runnerExplicit = runnerEq ?? (runnerNext && !runnerNext.startsWith("-") ? runnerNext : undefined)
if (runnerExplicit !== undefined && runnerExplicit !== "pi" && runnerExplicit !== "opencode") {
  console.error(`unknown runner '${runnerExplicit}': expected pi or opencode`)
  process.exit(2)
}
const planIdx = Bun.argv.indexOf("--plan")
const planPath = planIdx >= 0 ? Bun.argv[planIdx + 1] : undefined
if (planIdx >= 0 && (planPath === undefined || planPath.startsWith("-"))) {
  console.error("review: --plan needs a file path")
  process.exit(2)
}
const runner: Runner = runnerExplicit === "opencode" ? "opencode" : "pi"

// Intent-to-add first: the diff below must see new files.
const staged = stageIntentToAdd(stagedOnly)
if (staged.length > 0) {
  console.error(`review: intent-to-add ${staged.length} new file(s) so the diff sees them (index file-list only, no content staged)`)
}

let working
try {
  working = loadWorkingDiff(stagedOnly)
} catch (error) {
  console.error(`review: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
if (working.diff.trim().length === 0) {
  console.log("nothing to review: working tree matches HEAD")
  process.exit(0)
}

// Tier from a single numstat call (size + file list together).
const { diffLines, names } = parseNumstat(loadNumstat(stagedOnly))
const { tier, hot } = computeTier(diffLines, names)
if (tier === "trivial") {
  console.log(`review: trivial (${diffLines} diff lines across ${names.length} file(s)) — gate governs, no model call`)
  process.exit(0)
}

let plan
try {
  plan = await loadPlan(planPath)
} catch (error) {
  console.error(`review: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}
const memory = await loadMemory(names)
const brief = buildBrief({
  tier, diffLines, hot,
  planSection: plan.section,
  decisions: memory.decisions,
  learnings: memory.learnings,
  status: working.status,
  lockStatus: working.lockStatus
})

// Patch cache: same diff + same plan = same verdict.
const patchSha = sha12(working.diff)
const patchKey = cacheKey(patchSha, stagedOnly, plan.sha)
if (!dryRun) {
  const cache = await readCache()
  const hit = cache[patchKey]
  if (hit !== undefined) {
    console.log(`review: patch cache hit (${patchKey}, ${hit.tier}, ${hit.stamp}): ${hit.verdict}`)
    process.exit(hit.blocking > 0 ? 1 : 0)
  }
}

const tmp = `${process.env.TMPDIR ?? "/tmp"}/agent-webmcp-review-${process.pid}-${Math.random().toString(36).slice(2)}.diff`
await Bun.write(tmp, working.diff)
Bun.spawnSync(["chmod", "600", tmp])
// tmp lives until the verifier is done (or there is none): every exit past
// this point deletes it first — process.exit skips finally blocks, so the
// cleanup is explicit, not scoped.
const dropTmp = async (): Promise<void> => {
  await Bun.file(tmp).delete().catch(() => {})
}

const main = await dispatch(runner, runnerExplicit, brief, [tmp])
console.log(`reviewer: ${main.runnerName}`)

// Fail closed: no completed review, no green — not even advisory.
if (main.code !== 0) {
  await dropTmp()
  await recordReview({
    runnerName: main.runnerName, code: 1, head: shortHead(), staged: stagedOnly,
    tier, diffLines, planPath, planSha: plan.sha, patchKey, dryRun,
    verdictLine: "runner failed (no review completed)", verifierSection: ""
  }, brief, working.diff, main.output)
  console.error(main.output.slice(0, 2000))
  process.exit(1)
}

let verdictLine: string
const blocking = parseVerdict(main.output)
verdictLine = blocking === null ? "no verdict line (unconfirmable)" : `${blocking} BLOCKING`

// Opt-in verifier: reads each BLOCKING's file:line and kills the
// unverified (Cloudflare coordinator shape, one agent instead of seven).
let verifierSection = ""
let confirmed = blocking
if (wantVerify && (blocking ?? 0) > 0 && !dryRun) {
  const reviewTmp = `${process.env.TMPDIR ?? "/tmp"}/agent-webmcp-verify-${process.pid}-${Math.random().toString(36).slice(2)}.md`
  await Bun.write(reviewTmp, main.output)
  Bun.spawnSync(["chmod", "600", reviewTmp])
  console.log("reviewer: --verify — running verifier pass over BLOCKING findings")
  try {
    const verify = await dispatch(runner, runnerExplicit, VERIFY_BRIEF, [tmp, reviewTmp])
    verifierSection = `\n## verifier output (${verify.runnerName})\n\n${verify.output.trim() || "(no output)"}`
    const count = parseVerdict(verify.output)
    if (count !== null) {
      confirmed = count
      verdictLine = `${blocking} BLOCKING, ${confirmed} confirmed`
      if (confirmed === 0) console.log("reviewer: verifier killed all BLOCKINGs — cleared")
    } else {
      verifierSection += "\n(verifier gave no verdict line; main verdict stands)"
    }
    if (verify.code !== 0) verifierSection += "\n(verifier runner exited non-zero; main verdict stands)"
  } finally {
    await Bun.file(reviewTmp).delete().catch(() => {})
  }
}

await dropTmp()
await recordReview({
  runnerName: main.runnerName, code: 0, head: shortHead(), staged: stagedOnly,
  tier, diffLines, planPath, planSha: plan.sha, patchKey, dryRun,
  verdictLine, verifierSection
}, brief, working.diff, main.output + (verifierSection === "" ? "" : `\n${verifierSection}`))

// Patch cache stores the mechanical verdict for same-sha reruns.
if (!dryRun && blocking !== null) {
  await writeCache(patchKey, { stamp: stamp(), tier, verdict: verdictLine, blocking: confirmed ?? blocking })
}

if (dryRun) {
  console.log(`review: dry-run advisory — ${verdictLine}, exit 0`)
  process.exit(0)
}
// Fail closed (verdict.ts:gateRed): null is unconfirmable, which is red.
if (gateRed(blocking, confirmed)) {
  console.log(`review: gate red — ${verdictLine}`)
  process.exit(1)
}
console.log(`review: gate green — ${verdictLine}`)
process.exit(0)
