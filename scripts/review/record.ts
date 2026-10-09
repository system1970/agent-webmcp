// Durable review records. Local only (gitignored): timestamped so repeated
// runs never overwrite each other. Returns the record path.
import { REVIEW_MODEL } from "./runners.ts"
export interface RecordMeta {
  readonly runnerName: string
  readonly code: number
  readonly head: string
  readonly staged: boolean
  readonly tier: string
  readonly diffLines: number
  readonly planPath: string | undefined
  readonly planSha: string
  readonly patchKey: string
  readonly dryRun: boolean
  readonly verdictLine: string
  readonly verifierSection: string
}

export const recordReview = async (
  meta: RecordMeta, brief: string, diff: string, output: string
): Promise<string> => {
  const now = new Date()
  const p = (n: number): string => String(n).padStart(2, "0")
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  const file = `reviews/${stamp}-${meta.runnerName}.md`
  await Bun.write(file, [
    `# review ${stamp} (${meta.runnerName}, exit ${meta.code})`,
    ``,
    `- model: ${REVIEW_MODEL}`,
    `- HEAD: ${meta.head}${meta.staged ? " (staged diff)" : ""}`,
    `- tier: ${meta.tier} (${meta.diffLines} lines)`,
    `- plan: ${meta.planPath ?? "none"} (sha ${meta.planSha})`,
    `- patch: ${meta.patchKey}${meta.dryRun ? " (dry-run, advisory)" : ""}`,
    `- verdict: ${meta.verdictLine}${meta.verifierSection === "" ? "" : " (verifier ran)"}`,
    meta.verifierSection,
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
  return file
}
