import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { registerTool } from "./definition.ts"
import { statusSessions } from "../sessions/verbs.ts"

const Input = Schema.Struct({})

// Read-only observability: open sessions (handle + url) and spill usage.
// Records only, never dials a browser — safe to call before open, after
// close, or mid-flow to check what leaked.
export const status: WebmcpTool = {
  name: "status",
  description: "Read-only observability: open sessions (handle + url) and spill usage. Records only, never dials a browser.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function* () {
      yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "status", message: String(issue) }))
      )
      const report = yield* statusSessions().pipe(catchSession("status"))
      return { content: JSON.stringify(report) }
    })
}

registerTool(status)
