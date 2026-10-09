import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { registerTool } from "./definition.ts"
import { registerSessionTool } from "../sessions/verbs.ts"
import { INVOKE_TIMEOUT_MS, INVOKE_TIMEOUT_MAX_MS } from "../budgets.ts"

const ToolDef = Schema.Struct({
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.String,
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  annotations: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
})

const Input = Schema.Struct({
  handle: Schema.String,
  tool: ToolDef,
  code: Schema.String,
  timeoutMs: Schema.optional(Schema.Number)
})

// Author a custom tool onto the session page: spec-shaped
// (ModelContextTool minus the live function, plus the body source).
// The fixed harness snippet compiles the body debugger-side and calls
// the native registerTool — authored tools are indistinguishable from
// site-native. Session-scoped: close drops everything. Page refusals
// (duplicates, empty names) fail loud.
export const register: WebmcpTool = {
  name: "register",
  description: "Author a custom tool onto the session page: pass the tool record (name/title/description/schema/annotations) plus the JS body source. Registers natively; session-scoped, close drops it. Page refusals fail loud.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "register", message: String(issue) }))
      )
      const timeoutMs = input.timeoutMs ?? INVOKE_TIMEOUT_MS
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > INVOKE_TIMEOUT_MAX_MS) {
        return yield* Effect.fail(new ToolFailed({ tool: "register", message: `bad timeoutMs '${input.timeoutMs}': want 1-${INVOKE_TIMEOUT_MAX_MS} ms` }))
      }
      const result = yield* registerSessionTool(input.handle, {
        name: input.tool.name,
        ...(input.tool.title !== undefined ? { title: input.tool.title } : {}),
        description: input.tool.description,
        inputSchema: input.tool.inputSchema as Record<string, unknown>,
        ...(input.tool.annotations !== undefined
          ? { annotations: input.tool.annotations as Record<string, unknown> }
          : {}),
        code: input.code
      }, timeoutMs).pipe(catchSession("register"))
      return { content: JSON.stringify(result) }
    })
}

registerTool(register)
