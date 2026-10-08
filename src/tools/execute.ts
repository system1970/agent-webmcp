import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { findTool, registerTool } from "./definition.ts"
import { withSession } from "../sessions/connect.ts"
import { invokeTool, sessionTools } from "../transport/client.ts"
import { LIST_WINDOW_MS, INVOKE_TIMEOUT_MS, CHAR_BUDGET } from "../budgets.ts"
import { shapeResult } from "../spill.ts"
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

const MAX_CALLS = 5

// Shape one item's content (spilling past budget), never failing the
// batch: even a spill failure becomes an ok:false item with the reason.
// Spill path travels as structured data (see spill.ts canonical note).
const shapeItem = (
  tool: string,
  ok: boolean,
  content: string,
  maxChars: number | undefined
): Effect.Effect<{ tool: string; ok: boolean; result: string; spill: string | null }, never> =>
  shapeResult(content, maxChars, CHAR_BUDGET).pipe(
    Effect.map((shaped) => ({ tool, ok, result: shaped.text, spill: shaped.spilled })),
    Effect.catch(() => Effect.succeed({
      tool,
      ok: false as const,
      result: `${tool}: result too large and spill failed.`,
      spill: null
    }))
  )

// Run a batch of tool calls in parallel, one turn for many calls. Items never
// fail the batch: unknown tools and tool failures become `{ ok: false }`
// entries. sessionId routes page-tool calls to a session handle from
// `open` (omit for engine-local tools only). Page results carry origin +
// untrusted flags inside their JSON envelope.
export const execute: WebmcpTool = {
  name: "execute",
  description: "Run multiple tool calls in one turn. Takes calls [{tool, args}], optional sessionId (a session handle from open: routes page-tool calls to that page, each with the 30s invoke default) and maxChars per result. Returns JSON [{tool, ok, result, spill}]: spill names the full-body file when past budget (trust the field, never a path parsed from result text). For harnesses without native script composition.",
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
          return shapeItem(call.tool, false, `unknown tool: ${call.tool}`, maxChars)
        }
        return tool.execute(call.args).pipe(
          Effect.match({
            onFailure: (failure) => ({
              ok: false as const,
              content: failure instanceof ToolFailed
                ? `${failure.tool}: ${failure.message}`
                : String(failure)
            }),
            onSuccess: (result) => ({ ok: true as const, content: result.content })
          }),
          Effect.flatMap(({ ok, content }) => shapeItem(call.tool, ok, content, maxChars))
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
          return shapeItem(call.tool, false, JSON.stringify({
            error: `unknown tool '${call.tool}' on ${handle}`,
            available: tools.map((t) => t.name),
            origin: record.url,
            untrusted: true
          }), maxChars)
        }
        if (match.length > 1) {
          return shapeItem(call.tool, false, `ambiguous tool '${call.tool}' on ${handle}: ${match.length} frames.`, maxChars)
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
              ok: false as const,
              // Same one-line format as the CLI print path — reason,
              // operation, fix survive; only non-transport defects
              // stringify raw.
              content: failure instanceof TransportFailed
                ? asCliFailure(failure).message
                : String(failure)
            }),
            onSuccess: (result) => ({
              ok: true as const,
              content: JSON.stringify({
                tool: call.tool,
                status: result.status,
                output: result.output,
                errorText: result.errorText,
                origin: record.url,
                untrusted: true
              })
            })
          }),
          Effect.flatMap(({ ok, content }) => shapeItem(call.tool, ok, content, maxChars))
        )
      }
      const results = yield* Effect.all(calls.map(runOne), { concurrency: MAX_CALLS })
      return { content: JSON.stringify({ sessionId: handle, results }) }
    }))
})

registerTool(execute)
