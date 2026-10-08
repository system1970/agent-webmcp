import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { registerTool } from "./definition.ts"
import { closeSession } from "../sessions/verbs.ts"

const Input = Schema.Struct({
  handle: Schema.String
})

// Release one session: closes the page, kills browsers we launched (never
// foreign ones). Close what you open — one handle per open call.
export const close: WebmcpTool = {
  name: "close",
  description: "Release a session handle: closes its page and kills its browser if we launched it. Returns the closed handle.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "close", message: String(issue) }))
      )
      const handle = yield* closeSession(input.handle).pipe(catchSession("close"))
      return { content: JSON.stringify({ closed: handle }) }
    })
}

registerTool(close)
