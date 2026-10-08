import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { allTools, registerTool } from "./definition.ts"
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

// Compact signature from a JSON Schema: name plus required args with
// scalar types, `?` for optionals, `…` past 6 params. Defensive: page
// schemas are attacker-controlled shapes, so every access is guarded and
// anything unexpected degrades to `name(?)`. Bounded: keys truncate at
// 64 chars, the whole signature at 256 — a hostile schema (giant names,
// thousands of props) must not bloat the discovery entry point. Pure.
export const signature = (name: string, schema: unknown): string => {
  if (typeof schema !== "object" || schema === null) return `${name}(?)`
  const props = (schema as { properties?: unknown }).properties
  if (typeof props !== "object" || props === null) return `${name}()`
  const requiredRaw = (schema as { required?: unknown }).required
  const required = new Set(Array.isArray(requiredRaw) ? requiredRaw.filter((r): r is string => typeof r === "string") : [])
  const keys = Object.keys(props)
  const shown = keys.slice(0, 6).map((k) => {
    const raw = (props as Record<string, { type?: unknown }>)[k]?.type
    // Non-string unions (["null"], objects) collapse to "?" — documented
    // lossy, kept compact on purpose.
    const t = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.filter((x) => typeof x === "string").join("|") || "?" : "?"
    const key = k.length > 64 ? `${k.slice(0, 61)}…` : k
    return `${key}: ${required.has(k) ? t : `${t}?`}`
  })
  const more = keys.length > 6 ? ", …" : ""
  const full = `${name}(${shown.join(", ")}${more})`
  return full.length > 256 ? `${full.slice(0, 253)}…)` : full
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
  description: "Find tools by words in their name or description. Returns matching tools as JSON with compact signatures. Pass handle to include that session's page tools. Then describe one for the full schema. Use before execute when unsure what exists.",
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
      const local = allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        session: null as string | null,
        signature: signature(tool.name, tool.inputSchema)
      }))
      const sessionCatalog = input.handle === undefined
        ? null
        : yield* listSessionTools(input.handle).pipe(catchSession("search"))
      const catalog = sessionCatalog === null
        ? local
        : local.concat(sessionCatalog.tools.map((t) => ({
          name: t.name,
          description: t.description,
          session: sessionCatalog.handle as string | null,
          // No `{}` default: a missing schema renders `name(?)` (unknown),
          // never `name()` (takes no args) — those are different claims.
          signature: signature(t.name, t.inputSchema)
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

registerTool(search)
