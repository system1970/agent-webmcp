// unregister: drop one LIVE tool by name. Scoped to the session's
// authored record — native page tools are refused (never remove the
// page's own tools). Files STAY (the library outlives the page;
// deletion is `rm`, a human decision).
import { Effect, Schema } from "effect"
import { evaluateJson, listPageTools } from "../transport/client.ts"
import { SessionStore } from "../sessions/store.ts"
import { reattach } from "../sessions/sessions.ts"
import { parseUnregisterReply, unregisterSnippet } from "../registry/snippet.ts"
import { decodeArgs, toInputSchema, ToolFailed, type ToolCtx, type WebmcpTool } from "./definition.ts"

const Input = Schema.Struct({
  handle: Schema.String,
  name: Schema.String,
})

export const unregister: WebmcpTool = {
  name: "unregister",
  description:
    "Drop one authored tool from the live session by name (session authored record only — page-native tools are refused). Saved files stay; close drops everything live.",
  inputSchema: toInputSchema(Input),
  execute: (args: unknown, _ctx: ToolCtx) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(Input, "unregister")(args)
      const store = yield* SessionStore
      const record = yield* store.load(input.handle)
      if (!record.authored.includes(input.name)) {
        return yield* Effect.fail(
          new ToolFailed({
            tool: "unregister",
            detail: `'${input.name}' is not session-authored (native or unknown) — refusing; only authored tools unregister.`,
          })
        )
      }
      const { conn, sessionId } = yield* reattach(record)
      try {
        // Removal is AbortSignal cleanup (unregisterTool was removed
        // upstream — the register snippet stores one controller per
        // name on window.__agentWebmcp). A missing controller means the
        // page navigated (map wiped, tool already gone with it) — fail
        // loud naming that instead of pretending.
        const removed = yield* evaluateJson(conn, unregisterSnippet(input.name), 10000, sessionId)
        const refusal = parseUnregisterReply(removed)
        if (refusal !== null) {
          return yield* Effect.fail(new ToolFailed({ tool: "unregister", detail: refusal }))
        }
        // Verify absence: the snippet swallows refusal by contract
        // (best-effort page call), so the catalog is the truth. A tool
        // still present means the page refused silently — record and
        // page must never diverge, so fail loud instead of dropping.
        const catalog = yield* listPageTools(conn, 10000, sessionId)
        if (catalog.some((t) => t.name === input.name)) {
          return yield* Effect.fail(
            new ToolFailed({ tool: "unregister", detail: `'${input.name}' still listed after unregister — page refused silently.` })
          )
        }
        yield* store.save({ ...record, authored: record.authored.filter((n) => n !== input.name) })
        return { content: JSON.stringify({ unregistered: input.name, handle: input.handle }) }
      } finally {
        yield* conn.close
      }
    }),
}
