// search: one query across sessions. Named handles fail loud;
// without handles every session is swept best-effort, misses recorded
// in skipped (a dead browser degrades the sweep, never kills it).
import { Effect, Schema } from "effect"
import { listPageTools, type PageTool } from "../transport/client.ts"
import { SessionStore } from "../sessions/store.ts"
import { reattach } from "../sessions/sessions.ts"
import { decodeArgs, toInputSchema, ToolFailed, type ToolCtx, type WebmcpTool } from "./definition.ts"

const Input = Schema.Struct({
  query: Schema.String,
  handles: Schema.optional(Schema.Array(Schema.String)),
})

export interface SearchHit {
  readonly session: string
  readonly tool: PageTool
  readonly score: number
}

// Deterministic, additive, field-weighted: name exact 20, name part 8,
// description 4, schema-text 2. Sorted by score, ties alphabetical.
export const rankTools = (
  query: string,
  catalogs: ReadonlyArray<{ session: string; tools: ReadonlyArray<PageTool> }>
): Array<SearchHit> => {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== "" && t !== "*")
  const hits: Array<SearchHit> = []
  for (const { session, tools } of catalogs) {
    for (const tool of tools) {
      const name = tool.name.toLowerCase()
      const desc = tool.description.toLowerCase()
      const schemaText = JSON.stringify(tool.inputSchema).toLowerCase()
      let score = 0
      for (const term of terms) {
        const variants = term.endsWith("s") && term.length > 2 ? [term, term.slice(0, -1)] : [term]
        const hit = (hay: string): boolean => variants.some((v) => hay.includes(v))
        if (name === term) score += 20
        else if (hit(name)) score += 8
        if (hit(desc)) score += 4
        if (hit(schemaText)) score += 2
      }
      if (score > 0) hits.push({ session, tool, score })
    }
  }
  hits.sort((a, b) => b.score - a.score || (a.tool.name < b.tool.name ? -1 : 1))
  return hits
}

export const search: WebmcpTool = {
  name: "search",
  description: "Search page tools across sessions ({query, tools, skipped}). Name handles to fail loud, or omit them to sweep every session best-effort (misses land in skipped).",
  inputSchema: toInputSchema(Input),
  execute: (args: unknown, _ctx: ToolCtx) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(Input, "search")(args)
      const store = yield* SessionStore
      const records = yield* store.list()
      const wanted = input.handles ?? records.map((r) => r.handle)
      if (input.handles !== undefined) {
        const known = new Set(records.map((r) => r.handle))
        const unknownHandle = input.handles.find((h) => !known.has(h))
        if (unknownHandle !== undefined) {
          return yield* Effect.fail(new ToolFailed({ tool: "search", detail: `no such session: ${unknownHandle}` }))
        }
      }
      const catalogs: Array<{ session: string; tools: ReadonlyArray<PageTool> }> = []
      const skipped: Array<{ session: string; reason: string }> = []
      for (const handle of wanted) {
        const record = records.find((r) => r.handle === handle)
        if (record === undefined) {
          skipped.push({ session: handle, reason: "gone mid-sweep" })
          continue
        }
        const swept = yield* Effect.gen(function* () {
          const { conn, sessionId } = yield* reattach(record)
          try {
            return yield* listPageTools(conn, 10000, sessionId)
          } finally {
            yield* conn.close
          }
        }).pipe(Effect.result)
        if (swept._tag === "Success") catalogs.push({ session: handle, tools: swept.success })
        else skipped.push({ session: handle, reason: "browser unreachable" })
      }
      return { content: JSON.stringify({ query: input.query, tools: rankTools(input.query, catalogs), skipped }) }
    }),
}
