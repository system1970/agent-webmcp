// close: release sessions. One handle, or --all sweep. Best-effort on
// sweep: failures are reported per handle, never abort the rest — a dead
// browser degrades the sweep, it doesn't veto its siblings.
import { Effect, Result, Schema } from "effect"
import { closeSession, listSessions } from "../sessions/sessions.ts"
import { decodeArgs, toInputSchema, type ToolCtx, type WebmcpTool } from "./definition.ts"

const Input = Schema.Struct({
  handle: Schema.optional(Schema.String),
  all: Schema.optional(Schema.Boolean),
})

export const close: WebmcpTool = {
  name: "close",
  description: "Release sessions (kills browsers we launched, never foreign ones). One handle, or all:true to sweep every session best-effort with per-handle failures reported.",
  inputSchema: toInputSchema(Input),
  execute: (args: unknown, _ctx: ToolCtx) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(Input, "close")(args)
      if (input.all === true) {
        const records = yield* listSessions()
        const closed: Array<string> = []
        const failed: Array<{ handle: string; reason: string }> = []
        for (const record of records) {
          const outcome = yield* Effect.result(closeSession(record.handle))
          if (Result.isSuccess(outcome)) closed.push(record.handle)
          else failed.push({ handle: record.handle, reason: String(outcome.failure).slice(0, 200) })
        }
        return { content: JSON.stringify({ closed, failed }) }
      }
      if (input.handle === undefined) {
        return { content: JSON.stringify({ error: "pass handle or all:true" }) }
      }
      const out = yield* closeSession(input.handle)
      return { content: JSON.stringify({ closed: [out.closed] }) }
    }),
}
