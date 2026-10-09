// Model runners for the review gate. pi first (implicit default), opencode
// fallback on nested-403, explicit --runner=opencode direct. Both runners
// use model opencode-go/muse-spark-1.3-contributor; auth resolves from
// process env at spawn (OPENCODE_API_KEY) — never persisted, never quoted.
export type Runner = "pi" | "opencode"

export const REVIEW_MODEL = process.env.CODEREVIEW_MODEL ?? "opencode-go/muse-spark-1.3-contributor"

export interface Dispatch {
  readonly code: number
  readonly output: string
  readonly runnerName: string
}

async function runPi(prompt: string, files: Array<string>): Promise<{ ok: boolean; output: string; fallback403: boolean }> {
  // `@path` follows pi's documented `@path` contract (cli.md: file included
  // in the first prompt). Unverifiable from model-blocked sandboxes — if pi
  // ever ignores the attachment, the gate passes vacuous and this breaks loud.
  let proc
  try {
    proc = Bun.spawn(
      ["pi", "--print", "--model", REVIEW_MODEL, "--tools", "read,grep,find,ls", prompt, ...files.map((f) => `@${f}`)],
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

async function runOpencode(prompt: string, files: Array<string>): Promise<{ code: number; output: string }> {
  const args = ["run", "--agent", "code-reviewer", "--model", REVIEW_MODEL, "--auto"]
  for (const f of files) args.push("--file", f)
  args.push(prompt)
  const proc = Bun.spawn(["opencode", ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, errText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  const code = await proc.exited ?? 1
  // Print live; the record keeps everything.
  process.stdout.write(out)
  process.stderr.write(errText)
  return { code, output: `${out}\n${errText}` }
}

export const dispatch = async (
  runner: Runner, runnerExplicit: string | undefined, prompt: string, files: Array<string>
): Promise<Dispatch> => {
  if (runner === "pi") {
    const result = await runPi(prompt, files)
    if (result.ok) return { code: 0, output: result.output, runnerName: "pi" }
    if (result.fallback403 && runnerExplicit === undefined) {
      console.error("reviewer: pi unavailable (nested model access disabled) — falling back to opencode")
      const fallback = await runOpencode(prompt, files)
      return { code: fallback.code, output: fallback.output, runnerName: "opencode-fallback" }
    }
    return { code: 1, output: `reviewer: pi failed:\n${result.output.slice(0, 2000)}`, runnerName: "pi-failed" }
  }
  const final = await runOpencode(prompt, files)
  return { code: final.code, output: final.output, runnerName: "opencode" }
}
