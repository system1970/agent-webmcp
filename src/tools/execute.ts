import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession, registerTool } from "./definition.ts"
import { invokeSessionTool, listSessionTools } from "../sessions/verbs.ts"
import { runCode } from "../codemode/runner.ts"
import type { RunSessionSnapshot } from "../codemode/runner.ts"
import { RUN_TIMEOUT_DEFAULT_MS, RUN_TIMEOUT_MAX_MS, RUN_MAX_TOOL_CALLS, RUN_MAX_CODE_CHARS, RUN_MAX_DONE_CHARS, RUN_MAX_SESSIONS, INVOKE_TIMEOUT_MS, CHAR_BUDGET, SEARCH_SWEEP_CONCURRENCY } from "../budgets.ts"
import { shapeResult } from "../spill.ts"

const Input = Schema.Struct({
  code: Schema.String,
  // Single session: bare tools/search/describe bind to it. Exactly one
  // of handle/sessions; sessions maps caller aliases to handles for
  // multi-page flows (sesh.ALIAS.tools.* in code).
  handle: Schema.optional(Schema.String),
  sessions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  timeoutMs: Schema.optional(Schema.Number),
  maxChars: Schema.optional(Schema.Number)
})

// Non-finite maxChars (NaN/Infinity) means "no usable budget": fall
// back, like search's clampLimit. Finite values pass through —
// shapeResult clamps huge to CHAR_BUDGET itself. Non-positive finite
// is a caller bug, not a clamp case: throw RangeError so the single
// call site below fails loud pre-dial (mirrors the CLI flag).
export const sanitizeMaxChars = (maxChars: number | undefined): number | undefined => {
  if (maxChars === undefined || !Number.isFinite(maxChars)) return undefined
  if ((maxChars as number) <= 0) throw new RangeError(`bad maxChars '${maxChars}': want positive integer`)
  return maxChars
}

// Execute agent-written JS against session page tools, one turn for a
// whole flow: loops, branches, filters in code. Single session binds
// bare tools.<name>(args) plus search(query)/describe(name) globals;
// multi-session binds sesh.ALIAS.tools.<name> (aliases caller-chosen,
// dodging same-name collisions structurally). The worker is accident
// containment (denied names shadowed, runaways killed, calls capped) —
// not a security boundary: it runs with operator privilege and the
// bridge is the deliberate channel. Page outputs stay data; the
// envelope carries origins[] (contributor list) + untrusted by default
// because page text may flow anywhere.
export const execute: WebmcpTool = {
  name: "execute",
  description: `Run JavaScript code against session page tools — loops, branches, filters, one turn. Runs with YOUR privilege (accident containment, not a sandbox: constructor-escape, dynamic import(), forged completion known; kill unconditional, spawns may survive). Single (handle): bare tools.<name>(args), search(query), describe(name). Multi (sessions {alias: handle}, max ${RUN_MAX_SESSIONS}): sesh.ALIAS.tools.<name>(args), per-session search, describe(name, session?). ${RUN_MAX_TOOL_CALLS} invokes max; each call up to ${INVOKE_TIMEOUT_MS / 1000}s; bridge traffic up to ${CHAR_BUDGET.max} chars each way; final value up to ${RUN_MAX_DONE_CHARS} chars. Returns {value, spilled, toolCalls, perSession, origins, untrusted:true}: value JSON-encoded unless spilled (truncated prefix — read the file). timeoutMs? default ${RUN_TIMEOUT_DEFAULT_MS}, max ${RUN_TIMEOUT_MAX_MS}. Full catalog: SKILL.md.`,
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "execute", message: String(issue) }))
      )
      // Deterministically rejectable inputs fail before any CDP dial:
      // bad timeout, empty/oversized code, bad session wiring never
      // reach a browser.
      const timeoutMs = input.timeoutMs ?? RUN_TIMEOUT_DEFAULT_MS
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > RUN_TIMEOUT_MAX_MS) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", message: `bad timeoutMs '${input.timeoutMs}': want 1-${RUN_TIMEOUT_MAX_MS} ms` }))
      }
      if (input.code.trim().length === 0) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", message: "code is empty." }))
      }
      if (input.code.length > RUN_MAX_CODE_CHARS) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", message: `code is ${input.code.length} chars (max ${RUN_MAX_CODE_CHARS}): chunk the block.` }))
      }
      let maxChars: number | undefined
      try {
        maxChars = sanitizeMaxChars(input.maxChars)
      } catch (cause) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", message: String((cause as Error | null)?.message ?? cause) }))
      }
      // Exactly one of handle/sessions; sessions needs ≥1 entry with
      // non-empty aliases. A bare handle is sugar for a one-entry map
      // keyed by the handle itself (valid identifier chars by
      // construction: s_ + base36).
      const hasHandle = input.handle !== undefined
      const hasSessions = input.sessions !== undefined
      if (hasHandle === hasSessions) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", message: "pass exactly one of handle/sessions." }))
      }
      const entries: Array<[string, string]> = hasHandle
        ? [[input.handle as string, input.handle as string]]
        : Object.entries(input.sessions as Record<string, string>)
      if (entries.length === 0) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", message: "sessions needs at least one alias." }))
      }
      if (entries.length > RUN_MAX_SESSIONS) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", message: `at most ${RUN_MAX_SESSIONS} sessions per run, got ${entries.length}: close something first.` }))
      }
      // Same handle under two aliases dials twice, splits perSession,
      // and collapses origins — always a caller mistake, never intent.
      const seenHandles = new Set<string>()
      for (const [, handle] of entries) {
        if (seenHandles.has(handle)) {
          return yield* Effect.fail(new ToolFailed({ tool: "execute", message: `session '${handle}' bound twice: one alias per handle.` }))
        }
        seenHandles.add(handle)
      }
      for (const [alias] of entries) {
        if (alias.length === 0) {
          return yield* Effect.fail(new ToolFailed({ tool: "execute", message: "session aliases must be non-empty strings." }))
        }
        // Aliases ride a Proxy get-trap plus a plain-object map: reject
        // anything that isn't a safe identifier or that collides with
        // the prototype chain (__proto__/constructor/prototype would
        // confuse routing with inheritance — self-confusion, refused
        // here instead of debugged later).
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(alias) || alias === "__proto__" || alias === "constructor" || alias === "prototype") {
          return yield* Effect.fail(new ToolFailed({ tool: "execute", message: `bad session alias '${alias}': want a plain identifier, not a prototype-chain name.` }))
        }
      }
      // One catalog fetch per bound session (independent: fan out).
      // Unknown handles fail loud pre-code, same as unknown tools
      // fail loud in-code — explicit addressing is a precise claim.
      // Fan-out capped like the search sweep: a wedged browser farm
      // degrades a run, never multiplies it.
      const snapshots = yield* Effect.all(
        entries.map(([alias, handle]) =>
          listSessionTools(handle).pipe(
            catchSession("execute"),
            Effect.map((catalog) => [alias, {
              handle,
              origin: catalog.url,
              tools: catalog.tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: (t as { inputSchema?: unknown }).inputSchema ?? {},
                annotations: (t as { annotations?: unknown }).annotations ?? {}
              }))
            }] as const)
          )
        ),
        { concurrency: SEARCH_SWEEP_CONCURRENCY }
      ).pipe(
        Effect.map((pairs) => Object.fromEntries(pairs) as Record<string, RunSessionSnapshot>)
      )
      const result = yield* runCode({
        code: input.code,
        sessions: snapshots,
        ...(entries.length === 1 ? { defaultAlias: entries[0][0] } : {}),
        // Per-call ceiling, not the run budget: one hung page tool
        // must not consume the whole run. Capped at the run's own
        // budget too — a 5s run must not admit a 30s page call that
        // outlives the worker kill. Output size is capped runner-side
        // for every op (maxResultChars), so N sessions of unbounded
        // outputs can't OOM the host.
        dispatch: (alias, tool, callArgs) => {
          const snapshot = snapshots[alias] as RunSessionSnapshot
          return invokeSessionTool(snapshot.handle, tool, callArgs, Math.min(timeoutMs, INVOKE_TIMEOUT_MS)).pipe(
            Effect.mapError((f) => ({ message: `${f._tag}: ${f.message}` })),
            // Page-level Error throws catchable into code (compensation
            // flows depend on it: try invoke, catch, compensate). Infra
            // failures already reject above; status is the page's own
            // verdict — non-Completed is a failure, never data.
            Effect.flatMap((r) => r.status === "Completed"
              ? Effect.succeed(r.output as unknown)
              : Effect.fail({
                message: `${tool} on '${alias}' failed (${r.status})${r.errorText ? `: ${r.errorText}` : ""}`
              }))
          )
        },
        timeoutMs,
        maxToolCalls: RUN_MAX_TOOL_CALLS,
        // Result ceiling for EVERY bridge op (invoke/search/describe),
        // enforced runner-side: one large catalog/schema can't blow the
        // structured-clone. Same budget as the final shaping so the
        // failure mode is uniform: chunk the read. The final `done`
        // value has its own wider cap (RUN_MAX_DONE_CHARS) so the spill
        // path keeps working under it.
        maxResultChars: CHAR_BUDGET.max,
        maxDoneChars: RUN_MAX_DONE_CHARS
      }).pipe(
        Effect.mapError((f) => new ToolFailed({ tool: "execute", message: f.message }))
      )
      const text = yield* Effect.try(() => JSON.stringify(result.value) ?? "null").pipe(
        Effect.mapError((cause) => new ToolFailed({ tool: "execute", message: `result is not JSON-serializable: ${String(cause)}` }))
      )
      // Clamp via shapeResult (CLI/MCP divergence is deliberate, same
      // as before: the CLI validates positive-int at the flag; finite
      // out-of-range values clamp to CHAR_BUDGET here).
      const shaped = yield* shapeResult(text, maxChars, CHAR_BUDGET).pipe(
        Effect.mapError((cause) => new ToolFailed({ tool: "execute", message: `spill failed: ${cause instanceof Error ? cause.message : String(cause)}` }))
      )
      return {
        content: JSON.stringify({
          value: shaped.text,
          spilled: shaped.spilled,
          toolCalls: result.toolCalls,
          perSession: result.perSession,
          origins: result.origins,
          untrusted: true
        })
      }
    })
}

registerTool(execute)
