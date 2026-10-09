import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed, toInputSchema, catchSession } from "./definition.ts"
import { allTools, registerTool } from "./definition.ts"
import { listSessionTools } from "../sessions/verbs.ts"
import { listSessions, loadSession } from "../sessions/store.ts"
import { RUN_MAX_SESSIONS, SEARCH_SWEEP_CONCURRENCY } from "../budgets.ts"

const Input = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number),
  handle: Schema.optional(Schema.String),
  // Working-set discovery: extra sessions to include (union with
  // handle), or all open sessions. Results keep per-tool session
  // tags so callers route follow-ups to the right handle.
  handles: Schema.optional(Schema.Array(Schema.String)),
  all: Schema.optional(Schema.Boolean)
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
  description: "Find tools by words in their name or description. Returns matching tools as JSON with compact signatures. Pass handle (or handles/all) to include those sessions' page tools, tagged per session. Then list one for the full record. Use before execute when unsure what exists.",
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
      // `all` sweeps the whole working set — combining it with explicit
      // handles is ambiguous (confirm-then-sweep isn't a semantic), so
      // refuse it like execute refuses --session+--as. Empty handles
      // would silently mean local-only — refuse that too, same reason.
      if (input.all === true && (input.handle !== undefined || (input.handles ?? []).length > 0)) {
        return yield* Effect.fail(new ToolFailed({ tool: "search", message: "pass either all or handle/handles, not both." }))
      }
      if (input.handles !== undefined && input.handles.length === 0) {
        return yield* Effect.fail(new ToolFailed({ tool: "search", message: "handles is empty: pass a handle, more handles, or all." }))
      }
      const limit = clampLimit(input.limit)
      const local = allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        session: null as string | null,
        signature: signature(tool.name, tool.inputSchema)
      }))
      // Explicit handles fail loud (precise addressing); --all sweeps
      // best-effort (dead sessions land in `skipped`, never fail the
      // sweep — reconnaissance, not action).
      let wanted: Array<string> = []
      if (input.all === true) {
        const records = yield* listSessions().pipe(catchSession("search"))
        wanted = records.map((record) => record.handle)
      } else {
        if (input.handle !== undefined) wanted.push(input.handle)
        for (const handle of input.handles ?? []) {
          if (!wanted.includes(handle)) wanted.push(handle)
        }
      }
      // Count post-union, every lane including --all: dedupe first so
      // one session named twice dials once and counts once; N open
      // sessions must not mean N unbounded dials. Over it, close
      // something first.
      if (wanted.length > RUN_MAX_SESSIONS) {
        return yield* Effect.fail(new ToolFailed({ tool: "search", message: `at most ${RUN_MAX_SESSIONS} sessions per sweep, got ${wanted.length}.` }))
      }
      const catalogs: Array<{ handle: string; tools: ReadonlyArray<{ readonly name: string; readonly description: string; readonly inputSchema: unknown }> }> = []
      const skipped: Array<{ session: string; reason: string }> = []
      if (input.all === true) {
        // Best-effort with a narrow skip: "no-browser" (dead browser
        // behind a live record) and vanished records (unknown session:
        // deleted between listSessions and fetch) land in `skipped`.
        // Timeouts, protocol errors, and anything else fail the sweep
        // loud — those are real problems, not absence. Defects bypass
        // all catches and die loud as always.
        const settled = yield* Effect.all(
          wanted.map((handle) =>
            listSessionTools(handle).pipe(
              Effect.map((catalog) => ({ ok: true as const, catalog })),
              Effect.catchTag("TransportFailed", (failure) =>
                failure.reason === "no-browser"
                  ? Effect.succeed({ ok: false as const, handle, reason: failure.message })
                  : Effect.fail(new ToolFailed({ tool: "search", message: `${failure.operation}: ${failure.message}` }))),
              // Unknown-session can only happen here if the record
              // vanished between listSessions and fetch (the handles
              // came from the store). Re-check structurally instead of
              // regexing the message: still gone → skip, present →
              // the original failure stands, loud.
              Effect.catchTag("CliFailure", (failure) =>
                Effect.flatMap(
                  loadSession(handle),
                  () => Effect.fail(new ToolFailed({ tool: "search", message: failure.message }))
                ).pipe(
                  Effect.catchTag("CliFailure", () =>
                    Effect.succeed({ ok: false as const, handle, reason: failure.message }))
                ))
            )
          ),
          { concurrency: SEARCH_SWEEP_CONCURRENCY }
        )
        for (const entry of settled) {
          if (entry.ok) {
            catalogs.push({ handle: entry.catalog.handle, tools: entry.catalog.tools })
          } else {
            skipped.push({ session: entry.handle, reason: entry.reason })
          }
        }
      } else {
        // Explicit handles fail loud (fail-before-dial for precise
        // addressing): fan out at the sweep cap, first failure wins —
        // same contract as the serial loop, sessions in parallel.
        const cataloged = yield* Effect.all(
          wanted.map((handle) =>
            listSessionTools(handle).pipe(
              catchSession("search"),
              Effect.map((catalog) => ({ handle: catalog.handle, tools: catalog.tools }))
            )
          ),
          { concurrency: SEARCH_SWEEP_CONCURRENCY }
        )
        for (const entry of cataloged) {
          catalogs.push(entry)
        }
      }
      const catalog = local.concat(...catalogs.map((sessionCatalog) =>
        sessionCatalog.tools.map((t) => ({
          name: t.name,
          description: t.description,
          session: sessionCatalog.handle as string | null,
          // No `{}` default: a missing schema renders `name(?)` (unknown),
          // never `name()` (takes no args) — those are different claims.
          signature: signature(t.name, t.inputSchema)
        }))
      ))
      const ranked = catalog
        .map((tool) => ({ tool, rank: score(terms, tool) }))
        .filter((entry) => entry.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit)
        .map(({ tool }) => tool)
      return { content: JSON.stringify({ query: input.query, tools: ranked, skipped }) }
    })
}

registerTool(search)
