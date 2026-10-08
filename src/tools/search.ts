import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { allTools } from "./registry.ts"
import { listSessionTools } from "../sessions/verbs.ts"

const Input = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
  handle: Schema.optional(Schema.String)
})

const tokens = (text: string): Array<string> =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0)

const DEFAULT_LIMIT = 8
const MIN_LIMIT = 1
const MAX_LIMIT = 50

// Clamp the result budget. Pure: unit-tested directly. Non-finite input
// (NaN, Infinity) means "no usable budget", so it falls back to default.
export const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)))
}

// Word-overlap ranking over name + description. Name hits weigh 3x: a tool
// named like the query is the answer. Deliberately small — when the catalog
// (page tools included) outgrows it, this becomes BM25 without changing the
// tool contract.
const score = (terms: Array<string>, tool: { name: string; description: string }): number => {
  const name = tool.name.toLowerCase()
  const description = tool.description.toLowerCase()
  return terms.reduce(
    (sum, term) => sum + (name.includes(term) ? 3 : 0) + (description.includes(term) ? 1 : 0),
    0
  )
}

export const search: WebmcpTool = {
  name: "search",
  description: "Find tools by words in their name or description. Returns matching tools as JSON. Pass handle to include that session's page tools. Use before execute when unsure what exists.",
  inputSchema: toInputSchema(Input),
  execute: (args) =>
    Effect.gen(function*() {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "search", message: String(issue) }))
      )
      const terms = tokens(input.query)
      if (terms.length === 0) {
        return yield* Effect.fail(new ToolFailed({ tool: "search", message: "query is empty" }))
      }
      const limit = clampLimit(input.limit)
      const local = allTools.map((tool) => ({ name: tool.name, description: tool.description, session: null as string | null }))
      const sessionCatalog = input.handle === undefined
        ? null
        : yield* listSessionTools(input.handle).pipe(catchSession("search"))
      const catalog = sessionCatalog === null
        ? local
        : local.concat(sessionCatalog.tools.map((t) => ({
          name: t.name,
          description: t.description,
          session: sessionCatalog.handle as string | null
        })))
      const ranked = catalog
        .map((tool) => ({ tool, rank: score(terms, tool) }))
        .filter((entry) => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit)
        .map(({ tool }) => tool)
      return { content: JSON.stringify({ query: input.query, tools: ranked }) }
    })
}
