import { Console, Effect } from "effect"
import { execute as executeTool } from "../tools/execute.ts"
import { UsageError, CliFailure } from "../failure.ts"
import { RUN_TIMEOUT_MAX_MS } from "../budgets.ts"

// execute [--session H | --as ALIAS=H ...] [--timeout ms 1-RUN_TIMEOUT_MAX_MS] [--max-chars N]
// [--json] '<code>': thin argv shell over the execute tool. Single
// session binds bare tools.*; --as repeats for multi-page flows
// (sesh.ALIAS.tools.* in code). Human summary default, full envelope
// with --json.
export const execute = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let session: string | undefined
    const aliases: Array<[string, string]> = []
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
          return yield* Effect.fail(new UsageError({ message: `execute: ${arg} needs a session handle` }))
        }
      } else if (arg === "--as") {
        const raw = args[++i]
        if (raw === undefined) {
          return yield* Effect.fail(new UsageError({ message: "execute: --as needs ALIAS=HANDLE" }))
        }
        const eq = raw.indexOf("=")
        if (eq <= 0 || eq === raw.length - 1) {
          return yield* Effect.fail(new UsageError({ message: `execute: bad --as '${raw}': want ALIAS=HANDLE` }))
        }
        const alias = raw.slice(0, eq)
        if (aliases.some(([taken]) => taken === alias)) {
          return yield* Effect.fail(new UsageError({ message: `execute: duplicate --as alias '${alias}'.` }))
        }
        // Same identifier rule as the tool lane (unknown session
        // handles still resolve downstream — this gate is about
        // routing sanity, not existence).
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(alias) || alias === "__proto__" || alias === "constructor" || alias === "prototype") {
          return yield* Effect.fail(new UsageError({ message: `execute: bad --as alias '${alias}': want a plain identifier, not a prototype-chain name.` }))
        }
        aliases.push([alias, raw.slice(eq + 1)])
      } else if (arg === "--timeout") {
        const raw = args[++i]
        timeoutMs = Number(raw)
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > RUN_TIMEOUT_MAX_MS) {
          return yield* Effect.fail(new UsageError({ message: `execute: bad --timeout '${raw ?? "(missing)"}': want 1-${RUN_TIMEOUT_MAX_MS} ms` }))
        }
      } else if (arg === "--max-chars") {
        const raw = args[++i]
        maxChars = Number(raw)
        if (!Number.isInteger(maxChars) || maxChars <= 0) {
          return yield* Effect.fail(new UsageError({ message: `execute: bad --max-chars '${raw ?? "(missing)"}': want positive integer` }))
        }
      } else if (arg.startsWith("-")) {
        return yield* Effect.fail(new UsageError({ message: `execute: unknown flag '${arg}'. Usage: execute [--session H | --as ALIAS=H ...] [--timeout ms 1-${RUN_TIMEOUT_MAX_MS}] [--max-chars N] [--json] '<code>'` }))
      } else if (code === undefined) {
        code = arg
      } else {
        return yield* Effect.fail(new UsageError({ message: `execute: unexpected argument '${arg}'.` }))
      }
    }
    if (session !== undefined && aliases.length > 0) {
      return yield* Effect.fail(new UsageError({ message: "execute: --session and --as exclude each other (one session or an alias map)." }))
    }
    if (session === undefined && aliases.length === 0) {
      return yield* Effect.fail(new UsageError({ message: "execute: missing session. Usage: execute [--session H | --as ALIAS=H ...] [--timeout ms 1-${RUN_TIMEOUT_MAX_MS}] [--max-chars N] [--json] '<code>'" }))
    }
    if (code === undefined) {
      return yield* Effect.fail(new UsageError({ message: "execute: missing '<code>'. Usage: execute [--session H | --as ALIAS=H ...] [--timeout ms 1-${RUN_TIMEOUT_MAX_MS}] [--max-chars N] [--json] '<code>'" }))
    }
    const sessions: Record<string, string> = {}
    for (const [alias, handle] of aliases) {
      sessions[alias] = handle
    }
    const content = yield* executeTool.execute({
      code,
      ...(session !== undefined ? { handle: session } : { sessions }),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(maxChars !== undefined ? { maxChars } : {})
    }).pipe(
      Effect.map((r) => r.content),
      Effect.catchTag("ToolFailed", (f) => Effect.fail(new CliFailure({ message: `execute: ${f.message}` })))
    )
    const parsed = yield* Effect.try(() => JSON.parse(content)).pipe(
      Effect.mapError((cause) => new CliFailure({ message: `execute: engine returned non-JSON (contract broken): ${String(cause)}` }))
    )
    // Narrow the multi-origin envelope: shape-checked, not just
    // presence-checked. untrusted:true is part of the contract the
    // tool guarantees — verify it where claimed.
    const isReport = (u: unknown): u is {
      value: string; spilled: string | null; toolCalls: number;
      perSession: Record<string, number>; origins: Array<string>; untrusted: true
    } => {
      if (typeof u !== "object" || u === null) return false
      const r = u as Record<string, unknown>
      const perSessionOk = typeof r.perSession === "object" && r.perSession !== null
        && Object.values(r.perSession).every((n) => typeof n === "number" && Number.isInteger(n) && (n as number) >= 0)
      const originsOk = Array.isArray(r.origins)
        && (r.origins as Array<unknown>).every((o) => typeof o === "string")
      return typeof r.value === "string"
        && (typeof r.spilled === "string" || r.spilled === null)
        && typeof r.toolCalls === "number"
        && Number.isInteger(r.toolCalls)
        && (r.toolCalls as number) >= 0
        && perSessionOk
        && originsOk
        && r.untrusted === true
    }
    if (!isReport(parsed)) {
      return yield* Effect.fail(new CliFailure({ message: "execute: engine returned JSON without the {value, spilled, toolCalls, perSession, origins, untrusted:true} envelope (contract broken)" }))
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
      yield* Console.log(`calls: ${String(report.toolCalls)} ${JSON.stringify(report.perSession)} (origins: ${report.origins.join(", ")}, untrusted)`)
      return yield* Effect.void
    }
    // Fallback is raw on non-JSON — deliberate, announced on stderr.
    // Posture, stated once: the ENVELOPE is strict (fail loud above),
    // the VALUE is lenient (warn + raw here) — a broken envelope
    // means a broken engine, a non-JSON value just means odd data.
    const shown = yield* Effect.try(() => JSON.parse(report.value) as unknown).pipe(
      Effect.catch(() =>
        Console.error("execute: value is not JSON-encoded (contract broken), showing raw").pipe(
          Effect.as(report.value)
        )
      )
    )
    yield* Console.log(`value: ${typeof shown === "string" ? shown : JSON.stringify(shown)}`)
    yield* Console.log(`calls: ${String(report.toolCalls)} ${JSON.stringify(report.perSession)} (origins: ${report.origins.join(", ")}, untrusted)`)
    return yield* Effect.void
  })
