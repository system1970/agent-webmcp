// list: a session's page tools. Rows by default; the full record for
// one tool on demand. Empty is not an error — the page exposes nothing.
import { Effect, Schema } from "effect"
import { listPageTools } from "../transport/client.ts"
import { SessionStore } from "../sessions/store.ts"
import { reattach } from "../sessions/sessions.ts"
import { decodeArgs, toInputSchema, type ToolCtx, type WebmcpTool } from "./definition.ts"

const Input = Schema.Struct({
  handle: Schema.String,
  tool: Schema.optional(Schema.String),
})

export const list: WebmcpTool = {
  name: "list",
  description: "Show a session's page tools (name + description rows; pass tool for the full record with schema). Empty means the page exposes nothing — not an error.",
  inputSchema: toInputSchema(Input),
  execute: (args: unknown, _ctx: ToolCtx) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(Input, "list")(args)
      const store = yield* SessionStore
      const record = yield* store.load(input.handle)
      const { conn, sessionId } = yield* reattach(record)
      try {
        const tools = yield* listPageTools(conn, 10000, sessionId)
        if (input.tool !== undefined) {
          const found = tools.find((t) => t.name === input.tool)
          return { content: JSON.stringify(found ?? { error: `no tool '${input.tool}' on ${input.handle}` }) }
        }
        return { content: JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description }))) }
      } finally {
        yield* conn.close
      }
    }),
}
