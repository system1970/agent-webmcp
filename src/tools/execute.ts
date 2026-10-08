import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema } from "./definition.ts"
// Cycle with registry.ts is safe today: this module only reads `findTool`
// inside the execute closure, long after both modules finished evaluating.
// When sessions wire up, break it properly by injecting the catalog
// (pass the tool list in) instead of importing it.
import { findTool } from "./registry.ts"

const Call = Schema.Struct({
  tool: Schema.String,
  args: Schema.Unknown
})

const Input = Schema.Struct({
  calls: Schema.Array(Call),
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
// entries. Only a malformed batch — or a sessionId (sessions are designed
// but unwired, see docs/sessions.md) — fails the call itself.
export const execute: WebmcpTool = {
  name: "execute",
  description: "Run multiple tool calls in one turn. Takes calls [{tool, args}], optional sessionId and maxChars per result. Returns JSON [{tool, ok, result}]. For harnesses without native script composition.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function*() {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "execute", message: String(issue) }))
      )
      if (input.sessionId !== undefined) {
        return yield* Effect.fail(
          new ToolFailed({
            tool: "execute",
            message: `unknown session '${input.sessionId}': sessions are not implemented yet (open is unwired)`
          })
        )
      }
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
