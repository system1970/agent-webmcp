import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema } from "./definition.ts"
import { allTools } from "./registry.ts"

const Input = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number)
})

const tokens = (text: string): Array<string> =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0)

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
  description: "Find tools by words in their name or description. Returns matching tools as JSON. Use before execute when unsure what exists.",
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
      const limit = input.limit ?? 8
      const ranked = allTools
        .map((tool) => ({ tool, rank: score(terms, tool) }))
        .filter((entry) => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit)
        .map(({ tool }) => ({ name: tool.name, description: tool.description }))
      return { content: JSON.stringify({ query: input.query, tools: ranked }) }
    })
}
