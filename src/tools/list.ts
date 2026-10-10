// list: a session's page tools. Rows by default; the full record for
// one tool on demand. Authored-live tools read `"authored": true` plus
// their file age (`lastVerified`); suspect names read `staleSuspect`.
// Empty is not an error — the page exposes nothing.
import { Effect, Schema } from "effect"
import { listPageTools } from "../transport/client.ts"
import { SessionStore } from "../sessions/store.ts"
import { reattach } from "../sessions/sessions.ts"
import { loadTool, REGISTRY_ENV, resolveReadRoot } from "../registry/registry.ts"
import { existsSync } from "node:fs"
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
        const root = resolveReadRoot(process.cwd(), process.env[REGISTRY_ENV], (d) => existsSync(`${d}/.agent-webmcp`))
        const mark = (name: string): { authored?: true; lastVerified?: number; staleSuspect?: true } => {
          if (!record.authored.includes(name)) return {}
          const out: { authored: true; lastVerified?: number; staleSuspect?: true } = { authored: true }
          if (record.suspect.includes(name)) out.staleSuspect = true
          return out
        }
        // Ages are best-effort file reads (missing file = live but
        // unfiled — still authored, no age). Never fails a list.
        const ages = new Map<string, number>()
        if (root !== undefined) {
          for (const name of record.authored) {
            const loaded = yield* loadTool(root, record.origin, name).pipe(Effect.orElseSucceed(() => null))
            if (loaded !== null && loaded.spec.lastVerified !== undefined) ages.set(name, loaded.spec.lastVerified)
          }
        }
        const withMarks = tools.map((t) => {
          const m = mark(t.name)
          const age = ages.get(t.name)
          return { ...t, ...m, ...(age !== undefined ? { lastVerified: age } : {}) }
        })
        if (input.tool !== undefined) {
          const found = withMarks.find((t) => t.name === input.tool)
          return { content: JSON.stringify(found ?? { error: `no tool '${input.tool}' on ${input.handle}` }) }
        }
        return { content: JSON.stringify(withMarks.map((t) => ({ name: t.name, description: t.description, ...("authored" in t ? { authored: true } : {}), ...("staleSuspect" in t ? { staleSuspect: true } : {}) }))) }
      } finally {
        yield* conn.close
      }
    }),
}
