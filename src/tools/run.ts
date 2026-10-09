import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession, registerTool } from "./definition.ts"
import { invokeSessionTool, listSessionTools } from "../sessions/verbs.ts"
import { runCode } from "../codemode/runner.ts"
import { RUN_TIMEOUT_DEFAULT_MS, RUN_TIMEOUT_MAX_MS, RUN_MAX_TOOL_CALLS, RUN_MAX_CODE_CHARS, RUN_MAX_DONE_CHARS, INVOKE_TIMEOUT_MS, CHAR_BUDGET } from "../budgets.ts"
import { shapeResult } from "../spill.ts"

const Input = Schema.Struct({
  handle: Schema.String,
  code: Schema.String,
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

// Run agent-written JS against a session's page tools: `tools.<name>(args)`
// plus `search(query)` / `describe(name)` globals, with loops, branches,
// and filters in code. The worker is accident containment (denied names
// shadowed, runaways killed, calls capped) — not a security boundary:
// it runs with operator privilege and the bridge is the deliberate
// channel. Page outputs stay data; the envelope is untrusted by default
// because page text may flow anywhere.
export const run: WebmcpTool = {
  name: "run",
  description: `Run JavaScript code against a session's page tools. Runs with YOUR privilege (accident containment, not a sandbox: caps bind cooperating code; known holes: constructor-escape, dynamic import(), forged completion; worker kill on timeout is unconditional but detached spawns may survive it). Globals: tools.<name>(args), search(query: page-tool names only, substring, case-insensitive), describe(name). ${RUN_MAX_TOOL_CALLS} invoke calls max (search/describe free of the count but size-capped like every bridge op; only the whole-run timeout binds them, while invoke additionally carries the per-call ceiling); each page call capped at up to ${INVOKE_TIMEOUT_MS / 1000}s (less for short runs: min(run timeout, per-call ceiling)); bridge traffic capped both directions at ${CHAR_BUDGET.max} JSON chars (requests pre-dispatch, results pre-clone), final value at ${RUN_MAX_DONE_CHARS} chars (${RUN_MAX_DONE_CHARS / 1000000}M) (catchable chunk-the-read error past per-call; over-budget finals fail the run instead — no code to catch in; unmeasurable values refused measurably). Returns JSON {value, spilled, toolCalls, origin, untrusted:true}: value is JSON-encoded (parse twice) unless spilled is set — then value is a truncated prefix, read the file. Final value shaped to maxChars (default 8000, spills past budget). Run timeout via timeoutMs? (default ${RUN_TIMEOUT_DEFAULT_MS}, max ${RUN_TIMEOUT_MAX_MS}). Loops/branches/filters run in-code, one turn total.`,
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "run", message: String(issue) }))
      )
      // Deterministically rejectable inputs fail before any CDP dial:
      // bad timeout, empty code, and oversized code never reach the browser.
      const timeoutMs = input.timeoutMs ?? RUN_TIMEOUT_DEFAULT_MS
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > RUN_TIMEOUT_MAX_MS) {
        return yield* Effect.fail(new ToolFailed({ tool: "run", message: `bad timeoutMs '${input.timeoutMs}': want 1-${RUN_TIMEOUT_MAX_MS} ms` }))
      }
      if (input.code.trim().length === 0) {
        return yield* Effect.fail(new ToolFailed({ tool: "run", message: "code is empty." }))
      }
      if (input.code.length > RUN_MAX_CODE_CHARS) {
        return yield* Effect.fail(new ToolFailed({ tool: "run", message: `code is ${input.code.length} chars (max ${RUN_MAX_CODE_CHARS}): chunk the block.` }))
      }
      // Finite non-positive maxChars is rejected loud (mirrors the CLI
      // flag); non-finite falls back downstream, huge finite clamps in
      // shapeResult. sanitizeMaxChars throws RangeError on the reject
      // case — single validator, caught into the tool lane here.
      let maxChars: number | undefined
      try {
        maxChars = sanitizeMaxChars(input.maxChars)
      } catch (cause) {
        return yield* Effect.fail(new ToolFailed({ tool: "run", message: String((cause as Error | null)?.message ?? cause) }))
      }
      const handle = input.handle
      const catalog = yield* listSessionTools(handle).pipe(catchSession("run"))
      // Snapshot, frozen for the run: tools added mid-run stay denied
      // (safe), tools removed mid-run are still attempted and fail
      // honestly downstream. Fail direction is benign either way.
      const names = new Set(catalog.tools.map((t) => t.name))
      const result = yield* runCode({
        code: input.code,
        timeoutMs,
        maxToolCalls: RUN_MAX_TOOL_CALLS,
        // Result ceiling for EVERY bridge op (invoke/search/describe),
        // enforced runner-side: one large catalog/schema can't blow the
        // structured-clone. Same budget as the final shaping so the
        // failure mode is uniform: chunk the read. The final `done`
        // value has its own wider cap (RUN_MAX_DONE_CHARS) so the spill
        // path keeps working under it.
        maxResultChars: CHAR_BUDGET.max,
        maxDoneChars: RUN_MAX_DONE_CHARS,
        bridge: {
          invoke: (tool, callArgs) => {
            if (!names.has(tool)) {
              return Effect.fail({ message: `unknown tool '${tool}' on ${handle}` })
            }
            // Per-call ceiling, not the run budget: one hung page tool
            // must not consume the whole run (no single page call may
            // pin a session — INVOKE_TIMEOUT_MS). Capped at the run's own
            // budget too — a 5s run must not admit a 30s page call that
            // outlives the worker kill. Output size is capped
            // runner-side for every op (maxResultChars above), so 25
            // unbounded outputs can't OOM the host — fail-closed with
            // a catchable chunk-the-read error, stated in the SKILL
            // beside this tool.
            return invokeSessionTool(handle, tool, callArgs, Math.min(timeoutMs, INVOKE_TIMEOUT_MS)).pipe(
              Effect.map((r) => r.output),
              Effect.mapError((f) => ({ message: `${f._tag}: ${f.message}` }))
            )
          },
          // Substring filter over the start-of-run snapshot: page tools
          // only (engine tools are already in the caller's context), no
          // ranking. Documented limitation, not an engine-search parity
          // claim — ranking lives in the `search` tool.
          search: (query) => Effect.succeed(
            catalog.tools
              .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
              .map((t) => ({ name: t.name, description: t.description }))
          ),
          describe: (name) => {
            const found = catalog.tools.find((t) => t.name === name)
            if (found === undefined) return Effect.fail({ message: `unknown tool '${name}'` })
            return Effect.succeed({
              name: found.name,
              description: found.description,
              inputSchema: found.inputSchema ?? {},
              annotations: found.annotations
            })
          }
        }
      }).pipe(
        Effect.mapError((f) => new ToolFailed({ tool: "run", message: f.message }))
      )
      const text = yield* Effect.try(() => JSON.stringify(result.value) ?? "null").pipe(
        Effect.mapError((cause) => new ToolFailed({ tool: "run", message: `result is not JSON-serializable: ${String(cause)}` }))
      )
      // Clamp via shapeResult (CLI/MCP divergence is deliberate, same
      // as execute: the CLI validates positive-int at the flag; finite
      // out-of-range values clamp to CHAR_BUDGET here).
      const shaped = yield* shapeResult(text, maxChars, CHAR_BUDGET).pipe(
        Effect.mapError((cause) => new ToolFailed({ tool: "run", message: `spill failed: ${cause instanceof Error ? cause.message : String(cause)}` }))
      )
      return {
        content: JSON.stringify({
          value: shaped.text,
          spilled: shaped.spilled,
          toolCalls: result.toolCalls,
          origin: catalog.url,
          untrusted: true
        })
      }
    })
}

registerTool(run)
