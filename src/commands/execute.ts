import { Console, Effect } from "effect"
import { execute as executeTool } from "../tools/execute.ts"
import { UsageError, CliFailure } from "../failure.ts"

// execute [--json] [--session H] [--max-chars N] '<json-calls>': thin argv
// shell over the execute tool. One turn, up to 5 calls. Human summary
// default, full envelope with --json.
export const execute = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let session: string | undefined
    let maxChars: number | undefined
    let json = false
    let rawCalls: string | undefined
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === "--json") {
        json = true
      } else if (arg === "--session" || arg === "--handle") {
        session = args[++i]
        if (session === undefined) {
          return yield* Effect.fail(new UsageError({ message: `execute: ${arg} needs a session handle` }))
        }
      } else if (arg === "--max-chars") {
        const raw = args[++i]
        maxChars = Number(raw)
        if (!Number.isInteger(maxChars) || maxChars <= 0) {
          return yield* Effect.fail(new UsageError({ message: `execute: bad --max-chars '${raw ?? "(missing)"}': want positive integer` }))
        }
      } else if (arg.startsWith("-")) {
        return yield* Effect.fail(new UsageError({ message: `execute: unknown flag '${arg}'. Usage: execute [--json] [--session H] [--max-chars N] '<json-calls>' (--handle is an accepted alias for --session)` }))
      } else if (rawCalls === undefined) {
        rawCalls = arg
      } else {
        return yield* Effect.fail(new UsageError({ message: `execute: unexpected argument '${arg}'.` }))
      }
    }
    if (rawCalls === undefined) {
      return yield* Effect.fail(new UsageError({ message: "execute: missing '<json-calls>'. Usage: execute [--json] [--session H] [--max-chars N] '<json-calls>'" }))
    }
    let calls: unknown
    try {
      calls = JSON.parse(rawCalls)
    } catch {
      return yield* Effect.fail(new UsageError({ message: "execute: calls are not JSON: pass an array [{tool, args}]." }))
    }
    const content = yield* executeTool.execute({
      calls,
      ...(session !== undefined ? { sessionId: session } : {}),
      ...(maxChars !== undefined ? { maxChars } : {})
    }).pipe(
      Effect.map((r) => r.content),
      Effect.catchTag("ToolFailed", (f) => Effect.fail(new CliFailure({ message: `execute: ${f.message}` })))
    )
    // Same contract as search: engine output parses or exit-1, never dump.
    const parsed = yield* Effect.tryPromise(() => Promise.resolve(JSON.parse(content))).pipe(
      Effect.mapError(() => new CliFailure({ message: "execute: engine returned non-JSON (contract broken)" }))
    )
    if (json) {
      yield* Console.log(JSON.stringify(parsed, null, 2))
      return yield* Effect.void
    }
    const report = parsed as { results: Array<{ tool: string; ok: boolean; result: string }> }
    for (const r of report.results) {
      const mark = r.ok ? "ok" : "FAIL"
      const preview = r.result.length > 120 ? r.result.slice(0, 120) + "…" : r.result
      yield* Console.log(`${r.tool}: ${mark} — ${preview.replace(/\n/g, " ")}`)
    }
    return yield* Effect.void
  })
