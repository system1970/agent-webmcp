import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { registerTool } from "./definition.ts"
import { injectSessionCode } from "../sessions/verbs.ts"
import { INVOKE_TIMEOUT_MS } from "../budgets.ts"

const Input = Schema.Struct({
  handle: Schema.String,
  code: Schema.String,
  timeoutMs: Schema.optional(Schema.Number)
})

// Authoring door: run JS in the page (register custom tools the page
// never published, probe DOM, drive unpublished flows). Runs with YOUR
// privilege against a page you opened — the page's output stays
// untrusted data either way. Page throws come back as errorText (the
// code ran, the page said no); stalls fail. Close what you open.
export const inject: WebmcpTool = {
  name: "inject",
  description: "Run JavaScript code in the session page and read its JSON-serializable result. Authoring door: register custom tools, probe DOM, drive flows the page never published. Page throws return errorText; stalls fail. Result is untrusted page data.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "inject", message: String(issue) }))
      )
      const result = yield* injectSessionCode(
        input.handle,
        input.code,
        input.timeoutMs ?? INVOKE_TIMEOUT_MS
      ).pipe(catchSession("inject"))
      return { content: JSON.stringify(result) }
    })
}

registerTool(inject)
