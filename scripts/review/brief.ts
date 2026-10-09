// Review brief assembly: frozen law + bounded appendices (tier, plan,
// memory). The base never changes per-run except the tier line, so model
// context caches; the plan (capped) and filtered learnings ride along.
import { sha12 } from "./cache.ts"

export interface BriefInput {
  readonly tier: string
  readonly diffLines: number
  readonly hot: boolean
  readonly planSection: string
  readonly decisions: string
  readonly learnings: string
  readonly status: string
  readonly lockStatus: string
}

export const buildBrief = (input: BriefInput): string => [
  "You are the standing code reviewer for /home/pracurser/Projects/agent-webmcp",
  "(Bun + TypeScript + Effect v4 CLI: minimal engine exposing web pages as MCP tools).",
  "First read AGENTS.md, MAP.md, docs/decisions.md, docs/review-learnings.md at the repo root; all four bind. Then review",
  "the attached working-tree diff on two axes: (1) Standards — effect-wrapped",
  "side effects, help-truth, least privilege, no stubs, mechanism-only comments;",
  "(2) Spec — match the approved plan below, no scope creep, no speculative machinery.",
  "Diff hunks are the target; full files are context. Do not flag theoretical-only risks,",
  "unchanged code, formatting-only edits, or timestamped research staleness.",
  "Re-litigation of docs/decisions.md without new evidence is out of scope.",
  "Severity: BLOCKING (blocks commit), SHOULD-FIX (batch one pass), NIT (cap 5, drop rest).",
  "Merge same (file,line,failure_mode); one finding per defect per file unless independent.",
  "Quote file:line for every finding. Keep it dense.",
  "Report only: do not edit, commit, or push.",
  "End with exactly: Verdict: N BLOCKING, M SHOULD-FIX, K NIT.",
  "",
  `Tier: ${input.tier} (${input.diffLines} diff lines${input.hot ? ", hot path touched" : ""}).`,
  "",
  input.planSection,
  input.decisions.trim() !== "" ? `\nMemory (decisions, binding):\n${input.decisions.trim()}` : "",
  input.learnings.trim() !== "" ? `\nMemory (learnings, approved rules):\n${input.learnings.trim()}` : "",
  "",
  "Context (git status):",
  input.status.trim() || "(clean status, diff vs HEAD)",
  input.lockStatus.trim() !== "" ? `Lockfile: ${input.lockStatus.trim()}` : "Lockfile: unchanged"
].join("\n")

// Unreadable --plan is a loud exit-2 at the call site (throw, don't exit
// here: helpers never own the process exit code).
export const loadPlan = async (planPath: string | undefined): Promise<{ section: string; sha: string }> => {
  if (planPath === undefined) {
    return {
      section: "No approved plan was pasted: judge Spec as scope-creep / speculative-machinery only, and say so.",
      sha: "none"
    }
  }
  const planText = await Bun.file(planPath).text().catch(() => "")
  if (planText.trim() === "") throw new Error(`cannot read --plan '${planPath}'`)
  const sha = sha12(planText)
  return { section: `Approved plan (${planPath}, sha ${sha}):\n${planText.trim().slice(0, 3000)}`, sha }
}

// Decisions bind whole (small file); learnings filter to the diff's top
// dirs so the brief stays bounded.
export const loadMemory = async (names: Array<string>): Promise<{ decisions: string; learnings: string }> => {
  const decisions = await Bun.file("docs/decisions.md").text().catch(() => "")
  const raw = await Bun.file("docs/review-learnings.md").text().catch(() => "")
  const topdirs = new Set(names.map((n) => n.split("/").slice(0, 2).join("/")))
  const learnings = raw.split("\n").filter((l) =>
    !l.startsWith("- L") || [...topdirs].some((d) => l.includes(d))
  ).join("\n")
  return { decisions, learnings }
}

export const VERIFY_BRIEF = [
  "You are verifying BLOCKING findings from a prior review (second file) against the diff (first file) and the working tree.",
  "First read AGENTS.md, MAP.md, docs/decisions.md at the repo root; they bind.",
  "For each BLOCKING: read the cited file:line. Keep it only if the defect is real on current code;",
  "kill it with one line of evidence if the code is correct, the hunk is context-only, or docs/decisions.md settles it.",
  "SHOULD-FIX and NIT are out of scope. Report only: do not edit, commit, or push.",
  "End with exactly: Verdict: N BLOCKING (confirmed)."
].join("\n")
