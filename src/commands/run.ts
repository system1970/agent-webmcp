import { Console, Effect } from "effect"
import { run as runTool } from "../tools/run.ts"
import { UsageError, CliFailure } from "../failure.ts"
import { RUN_TIMEOUT_MAX_MS } from "../budgets.ts"

// run --session H [--timeout ms] [--json] [--max-chars N] '<code>':
// thin argv shell over the run tool. Prints the result envelope as JSON.
export const run = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let session: string | undefined
    let timeoutMs: number | undefined
    let maxChars: number | undefined
    let json = false
    let code: string | undefined
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === "--json") {
        json = true
      } else if (arg === "--session" || arg === "--handle") {
        session = args[++i]
        if (session === undefined) {
          return yield* Effect.fail(new UsageError({ message: `run: ${arg} needs a session handle` }))
        }
      } else if (arg === "--timeout") {
        const raw = args[++i]
        timeoutMs = Number(raw)
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > RUN_TIMEOUT_MAX_MS) {
          return yield* Effect.fail(new UsageError({ message: `run: bad --timeout '${raw ?? "(missing)"}': want 1-${RUN_TIMEOUT_MAX_MS} ms` }))
        }
      } else if (arg === "--max-chars") {
        const raw = args[++i]
        maxChars = Number(raw)
        if (!Number.isInteger(maxChars) || maxChars <= 0) {
          return yield* Effect.fail(new UsageError({ message: `run: bad --max-chars '${raw ?? "(missing)"}': want positive integer` }))
        }
      } else if (arg.startsWith("-")) {
        return yield* Effect.fail(new UsageError({ message: `run: unknown flag '${arg}'. Usage: run --session H [--timeout ms] [--json] [--max-chars N] '<code>'` }))
      } else if (code === undefined) {
        code = arg
      } else {
        return yield* Effect.fail(new UsageError({ message: `run: unexpected argument '${arg}'.` }))
      }
    }
    if (session === undefined) {
      return yield* Effect.fail(new UsageError({ message: "run: missing --session. Usage: run --session H [--timeout ms] [--json] [--max-chars N] '<code>'" }))
    }
    if (code === undefined) {
      return yield* Effect.fail(new UsageError({ message: "run: missing '<code>'. Usage: run --session H [--timeout ms] [--json] [--max-chars N] '<code>'" }))
    }
    const content = yield* runTool.execute({
      handle: session,
      code,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(maxChars !== undefined ? { maxChars } : {})
    }).pipe(
      Effect.map((r) => r.content),
      Effect.catchTag("ToolFailed", (f) => Effect.fail(new CliFailure({ message: `run: ${f.message}` })))
    )
    const parsed = yield* Effect.try(() => JSON.parse(content)).pipe(
      Effect.mapError((cause) => new CliFailure({ message: `run: engine returned non-JSON (contract broken): ${String(cause)}` }))
    )
    // Narrow the envelope: shape-checked, not just presence-checked —
    // malformed-but-JSON must fail loud, never print
    // `calls: [object Object] ... from: 42`. untrusted:true is part of
    // the contract the tool guarantees — verify it where claimed.
    const isReport = (u: unknown): u is { value: string; spilled: string | null; toolCalls: number; origin: string; untrusted: true } => {
      if (typeof u !== "object" || u === null) return false
      const r = u as Record<string, unknown>
      return typeof r.value === "string"
        && (typeof r.spilled === "string" || r.spilled === null)
        && typeof r.toolCalls === "number"
        && Number.isInteger(r.toolCalls)
        && (r.toolCalls as number) >= 0
        && typeof r.origin === "string"
        && (r.origin as string).length > 0
        && r.untrusted === true
    }
    if (!isReport(parsed)) {
      return yield* Effect.fail(new CliFailure({ message: "run: engine returned JSON without the {value, spilled, toolCalls: integer, origin, untrusted:true} envelope (contract broken)" }))
    }
    const report = parsed
    if (json) {
      yield* Console.log(JSON.stringify(parsed, null, 2))
      return yield* Effect.void
    }
    // Human mode: value arrives JSON-encoded (parse twice) — unless
    // spilled, in which case it's a truncated prefix by design (read
    // the file). Branch on spilled FIRST so the designed large-output
    // path never trips the contract-broken alarm below.
    if (typeof report.spilled === "string") {
      yield* Console.log(`value (truncated, full body in spill file): ${report.value}`)
      yield* Console.log(`spilled: ${report.spilled}`)
      yield* Console.log(`calls: ${String(report.toolCalls)} (value above is untrusted page data from: ${String(report.origin)})`)
      return yield* Effect.void
    }
    // Fallback is raw on non-JSON — deliberate, announced on stderr.
    // Posture, stated once: the ENVELOPE is strict (fail loud above),
    // the VALUE is lenient (warn + raw here) — a broken envelope
    // means a broken engine, a non-JSON value just means odd data.
    const shown = yield* Effect.try(() => JSON.parse(report.value) as unknown).pipe(
      Effect.catch(() =>
        Console.error("run: value is not JSON-encoded (contract broken), showing raw").pipe(
          Effect.as(report.value)
        )
      )
    )
    yield* Console.log(`value: ${typeof shown === "string" ? shown : JSON.stringify(shown)}`)
    yield* Console.log(`calls: ${String(report.toolCalls)} (value above is untrusted page data from: ${String(report.origin)})`)
    return yield* Effect.void
  })
