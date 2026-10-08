import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { registerTool } from "./definition.ts"
import { openSession } from "../sessions/verbs.ts"

const Input = Schema.Struct({
  url: Schema.String,
  cdp: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number)
})

// Open a page session: returns a handle for list/invoke/close. Own
// browser by default (detached, killed by close); cdp borrows a tab of a
// foreign browser (navigates it — stated cost) and never kills it.
export const open: WebmcpTool = {
  name: "open",
  description: "Attach a web page and get a session handle for list/invoke/close. Returns JSON {handle, url, ...}. Own headless browser by default; pass cdp (DevTools http://host:port) to borrow a foreign tab instead.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "open", message: String(issue) }))
      )
      if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535)) {
        return yield* Effect.fail(new ToolFailed({ tool: "open", message: `bad port '${input.port}': want 1024-65535` }))
      }
      const record = yield* openSession(input).pipe(catchSession("open"))
      return { content: JSON.stringify(record) }
    })
}

registerTool(open)
