import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
// Cycle with registry.ts is safe today: this module only reads `findTool`
// inside the execute closure, long after both modules finished evaluating.
import { findTool } from "./registry.ts"
import { withSession } from "../sessions/connect.ts"
import { invokeTool, sessionTools } from "../transport/client.ts"
import { LIST_WINDOW_MS, INVOKE_TIMEOUT_MS } from "../budgets.ts"
import { asCliFailure } from "../failure.ts"
import { TransportFailed } from "../transport/errors.ts"

const Call = Schema.Struct({
  tool: Schema.String,
  args: Schema.Unknown
})

const Input = Schema.Struct({
  calls: Schema.Array(Call),
  // Legacy name, kept for contract stability (shipped pre-sessions as the
  // reserved routing field): the VALUE is a session handle from `open`.
  // New tools use `handle`; this one keeps `sessionId`.
  sessionId: Schema.optional(Schema.String),
  maxChars: Schema.optional(Schema.Number)
})

const DEFAULT_MAX_CHARS = 8000
const MIN_MAX_CHARS = 1000
const MAX_MAX_CHARS = 64000
const MAX_CALLS = 5

// Clamp the budget, then truncate with a marker. Pure: unit-tested directly.
export const shapeContent = (content: string, maxChars?: number): string => {
  const budget = Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, maxChars ?? DEFAULT_MAX_CHARS))
  return content.length > budget
    ? content.slice(0, budget) + `\n…[truncated at ${budget} chars]`
    : content
}

// Run a batch of tool calls in parallel, one turn for many calls. Items never
// fail the batch: unknown tools and tool failures become `{ ok: false }`
// entries. sessionId routes page-tool calls to a session handle from
// `open` (omit for engine-local tools only). Page results carry origin +
// untrusted flags inside their JSON envelope.
export const execute: WebmcpTool = {
  name: "execute",
  description: "Run multiple tool calls in one turn. Takes calls [{tool, args}], optional sessionId (a session handle from open: routes page-tool calls to that page, each with the 30s invoke default) and maxChars per result. Returns JSON [{tool, ok, result}]. For harnesses without native script composition.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function*() {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "execute", message: String(issue) }))
      )
      if (input.calls.length === 0) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", message: "no calls in batch" }))
      }
      if (input.calls.length > MAX_CALLS) {
        return yield* Effect.fail(
          new ToolFailed({
            tool: "execute",
            message: `at most ${MAX_CALLS} calls per batch, got ${input.calls.length}`
          })
        )
      }
      if (input.sessionId !== undefined) {
        // Shape-check every item pre-dial: malformed batches fail without
        // waking a browser (unknown names still resolve per-item inside,
        // against the live catalog).
        for (const call of input.calls) {
          if (typeof call.args !== "object" || call.args === null || Array.isArray(call.args)) {
            return yield* Effect.fail(new ToolFailed({
              tool: "execute",
              message: `args for '${call.tool}' must be a JSON object.`
            }))
          }
        }
        return yield* runSessionBatch(input.sessionId, input.calls, input.maxChars).pipe(
          catchSession("execute")
        )
      }
      const maxChars = input.maxChars
      const runOne = (call: { tool: string; args: unknown }) => {
        const tool = findTool(call.tool)
        if (tool === undefined) {
          return Effect.succeed({
            tool: call.tool,
            ok: false as const,
            result: `unknown tool: ${call.tool}`
          })
        }
        return tool.execute(call.args).pipe(
          Effect.match({
            onFailure: (failure) => ({
              tool: call.tool,
              ok: false as const,
              result: failure instanceof ToolFailed
                ? `${failure.tool}: ${failure.message}`
                : String(failure)
            }),
            onSuccess: (result) => ({
              tool: call.tool,
              ok: true as const,
              result: shapeContent(result.content, maxChars)
            })
          })
        )
      }
      const results = yield* Effect.all(input.calls.map(runOne), { concurrency: MAX_CALLS })
      return { content: JSON.stringify({ sessionId: input.sessionId ?? null, results }) }
    })
}

// One connection for the whole batch (not one dial per item): the CDP
// socket multiplexes by request id, so parallel invokes share it.
const runSessionBatch = Effect.fn("execute.sessionBatch")(function* (
  handle: string,
  calls: ReadonlyArray<{ tool: string; args: unknown }>,
  maxChars: number | undefined
) {
  return yield* withSession(handle, (conn, record, sessionId) =>
    Effect.gen(function*() {
      const tools = yield* sessionTools(conn, sessionId, LIST_WINDOW_MS)
      const runOne = (call: { tool: string; args: unknown }) => {
        const match = tools.filter((t) => t.name === call.tool)
        if (match.length === 0) {
          return Effect.succeed({
            tool: call.tool,
            ok: false as const,
            result: JSON.stringify({
              error: `unknown tool '${call.tool}' on ${handle}`,
              available: tools.map((t) => t.name),
              origin: record.url,
              untrusted: true
            })
          })
        }
        if (match.length > 1) {
          return Effect.succeed({
            tool: call.tool,
            ok: false as const,
            result: `ambiguous tool '${call.tool}' on ${handle}: ${match.length} frames.`
          })
        }
        const target = match[0]
        // Explicit default (not transport-implied): the description
        // promises 30s, the code passes 30s.
        return invokeTool(
          conn,
          sessionId,
          { frameId: target.frameId, toolName: call.tool, args: call.args as Record<string, unknown> },
          INVOKE_TIMEOUT_MS
        ).pipe(
          Effect.match({
            onFailure: (failure) => ({
              tool: call.tool,
              ok: false as const,
              // Same one-line format as the CLI print path — reason,
              // operation, fix survive; only non-transport defects
              // stringify raw.
              result: failure instanceof TransportFailed
                ? asCliFailure(failure).message
                : String(failure)
            }),
            onSuccess: (result) => ({
              tool: call.tool,
              ok: true as const,
              result: shapeContent(JSON.stringify({
                tool: call.tool,
                status: result.status,
                output: result.output,
                errorText: result.errorText,
                origin: record.url,
                untrusted: true
              }), maxChars)
            })
          })
        )
      }
      const results = yield* Effect.all(calls.map(runOne), { concurrency: MAX_CALLS })
      return { content: JSON.stringify({ sessionId: handle, results }) }
    }))
})
