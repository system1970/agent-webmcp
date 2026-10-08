import { Console, Effect } from "effect"
import { search as searchTool } from "../tools/search.ts"
import { UsageError, CliFailure } from "../failure.ts"

// search [--json] [--handle H] [--limit N] <query...>: thin argv shell
// over the search tool. Human rows default, full JSON with --json.
export const search = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let handle: string | undefined
    let limit: number | undefined
    let json = false
    const words: Array<string> = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === "--json") {
        json = true
      } else if (arg === "--handle") {
        handle = args[++i]
        if (handle === undefined) {
          return yield* Effect.fail(new UsageError({ message: "search: --handle needs a session handle" }))
        }
      } else if (arg === "--limit") {
        const raw = args[++i]
        limit = Number(raw)
        if (!Number.isInteger(limit) || limit <= 0) {
          return yield* Effect.fail(new UsageError({ message: `search: bad --limit '${raw ?? "(missing)"}': want positive integer` }))
        }
      } else if (arg.startsWith("-")) {
        return yield* Effect.fail(new UsageError({ message: `search: unknown flag '${arg}'. Usage: search [--json] [--handle H] [--limit N] <query...>` }))
      } else {
        words.push(arg)
      }
    }
    if (words.length === 0) {
      return yield* Effect.fail(new UsageError({ message: "search: missing query. Usage: search [--json] [--handle H] [--limit N] <query...>" }))
    }
    const content = yield* searchTool.execute({
      query: words.join(" "),
      ...(limit !== undefined ? { limit } : {}),
      ...(handle !== undefined ? { handle } : {})
    }).pipe(
      Effect.map((r) => r.content),
      Effect.catchTag("ToolFailed", (f) => Effect.fail(new CliFailure({ message: `search: ${f.message}` })))
    )
    // Tool output is always JSON.stringify — parse failure means the
    // engine broke its own contract, surfaced as clean exit-1, never dump.
    const parsed = yield* Effect.tryPromise(() => Promise.resolve(JSON.parse(content))).pipe(
      Effect.mapError(() => new CliFailure({ message: "search: engine returned non-JSON (contract broken)" }))
    )
    if (json) {
      yield* Console.log(JSON.stringify(parsed, null, 2))
      return yield* Effect.void
    }
    const report = parsed as { tools: Array<{ name: string; description: string; session: string | null }> }
    if (report.tools.length === 0) {
      yield* Console.log("no tools match.")
      return yield* Effect.void
    }
    for (const t of report.tools) {
      const where = t.session !== null ? ` [${t.session}]` : ""
      yield* Console.log(`${t.name} — ${t.description}${where}`)
    }
    return yield* Effect.void
  })
