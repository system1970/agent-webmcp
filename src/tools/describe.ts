import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { findTool, registerTool } from "./definition.ts"
import { listSessionTools } from "../sessions/verbs.ts"
import { shapeResult } from "../spill.ts"
import { CHAR_BUDGET } from "../budgets.ts"

const Input = Schema.Struct({
  tool: Schema.String,
  handle: Schema.optional(Schema.String),
  maxChars: Schema.optional(Schema.Number)
})

// Describe one tool fully: the second step of search → describe →
// invoke. Page tools resolve in their session (schema + annotations +
// frame + origin, untrusted); engine tools resolve locally (schema,
// session null). One record shape for both doors.
export const describe: WebmcpTool = {
  name: "describe",
  description: "Show one tool's full record: input schema, annotations, origin/session. Large schemas spill to a file path. Use after search, before invoke, when you need exact arg shapes.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "describe", message: String(issue) }))
      )
      if (input.handle !== undefined) {
        const catalog = yield* listSessionTools(input.handle).pipe(catchSession("describe"))
        const found = catalog.tools.find((t) => t.name === input.tool)
        if (found === undefined) {
          return yield* Effect.fail(new ToolFailed({
            tool: "describe",
            message: `unknown tool '${input.tool}' on ${input.handle}` +
              (catalog.tools.length > 0 ? ` (available: ${catalog.tools.map((t) => t.name).join(", ")})` : " (the page publishes nothing)")
          }))
        }
        return yield* emitRecord({
          name: found.name,
          description: found.description,
          inputSchema: found.inputSchema ?? {},
          annotations: found.annotations,
          frameId: found.frameId,
          origin: catalog.url,
          session: catalog.handle,
          untrusted: true
        }, input.maxChars)
      }
      const tool = findTool(input.tool)
      if (tool === undefined) {
        return yield* Effect.fail(new ToolFailed({
          tool: "describe",
          message: `unknown engine tool '${input.tool}'. Pass handle to describe a page tool.`
        }))
      }
      return yield* emitRecord({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        session: null,
        untrusted: false
      }, input.maxChars)
    })
}

// One budgeted emit path for both doors (see spill.ts canonical note).
const emitRecord = Effect.fn("describe.emit")(function* (
  record: Record<string, unknown>,
  maxChars: number | undefined
) {
  const body = JSON.stringify(record)
  const shaped = yield* shapeResult(body, maxChars, CHAR_BUDGET).pipe(
    Effect.mapError((cause) => new ToolFailed({ tool: "describe", message: `spill failed: ${String(cause)}` }))
  )
  if (shaped.spilled === null) return { content: body }
  const { inputSchema: _dropped, ...summary } = record
  return {
    content: JSON.stringify({
      ...summary,
      note: "full record spilled (schema too large); read the spill file, never a path from text",
      spill: shaped.spilled
    })
  }
})

registerTool(describe)
