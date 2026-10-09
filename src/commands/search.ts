import { Console, Effect } from "effect"
import { search as searchTool } from "../tools/search.ts"
import { UsageError, CliFailure } from "../failure.ts"

// search [--json] [--handle H ...] [--all] [--limit N] <query...>: thin argv
// shell over the search tool. --handle repeats for a working set, --all
// sweeps every open session (dead ones land in `skipped`). Human rows
// default, full JSON with --json.
export const search = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const handles: Array<string> = []
    let all = false
    let limit: number | undefined
    let json = false
    const words: Array<string> = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === "--json") {
        json = true
      } else if (arg === "--all") {
        if (handles.length > 0) {
          return yield* Effect.fail(new UsageError({ message: "search: --all and --handle exclude each other." }))
        }
        all = true
      } else if (arg === "--handle") {
        if (all) {
          return yield* Effect.fail(new UsageError({ message: "search: --all and --handle exclude each other." }))
        }
        const handle = args[++i]
        if (handle === undefined) {
          return yield* Effect.fail(new UsageError({ message: "search: --handle needs a session handle" }))
        }
        if (!handles.includes(handle)) handles.push(handle)
      } else if (arg === "--limit") {
        const raw = args[++i]
        limit = Number(raw)
        if (!Number.isInteger(limit) || limit <= 0) {
          return yield* Effect.fail(new UsageError({ message: `search: bad --limit '${raw ?? "(missing)"}': want positive integer` }))
        }
      } else if (arg.startsWith("-")) {
        return yield* Effect.fail(new UsageError({ message: `search: unknown flag '${arg}'. Usage: search [--json] [--handle H ...] [--all] [--limit N] <query...>` }))
      } else {
        words.push(arg)
      }
    }
    if (words.length === 0) {
      return yield* Effect.fail(new UsageError({ message: "search: missing query. Usage: search [--json] [--handle H ...] [--all] [--limit N] <query...>" }))
    }
    const content = yield* searchTool.execute({
      query: words.join(" "),
      ...(limit !== undefined ? { limit } : {}),
      ...(handles.length === 1 ? { handle: handles[0] } : {}),
      ...(handles.length > 1 ? { handles } : {}),
      ...(all ? { all: true as const } : {})
    }).pipe(
      Effect.map((r) => r.content),
      Effect.catchTag("ToolFailed", (f) => Effect.fail(new CliFailure({ message: `search: ${f.message}` })))
    )
    // Tool output is always JSON.stringify — parse failure means the
    // engine broke its own contract, surfaced as clean exit-1, never dump.
    const parsed = yield* Effect.try(() => JSON.parse(content)).pipe(
      Effect.mapError(() => new CliFailure({ message: "search: engine returned non-JSON (contract broken)" }))
    )
    if (json) {
      yield* Console.log(JSON.stringify(parsed, null, 2))
      return yield* Effect.void
    }
    const report = parsed as {
      tools: Array<{ name: string; description: string; session: string | null }>
      skipped?: Array<{ session: string; reason: string }>
    }
    // Narrow the envelope like execute does: malformed-but-JSON must
    // fail loud (exit 1), never defect-dump on report.tools.length.
    if (!Array.isArray(report.tools)) {
      return yield* Effect.fail(new CliFailure({ message: "search: engine returned JSON without a tools array (contract broken)" }))
    }
    const skipped = Array.isArray(report.skipped) ? report.skipped : []
    if (report.tools.length === 0 && skipped.length === 0) {
      yield* Console.log("no tools match.")
      return yield* Effect.void
    }
    for (const t of report.tools) {
      const where = t.session !== null ? ` [${t.session}]` : ""
      yield* Console.log(`${t.name} — ${t.description}${where}`)
    }
    // Best-effort sweeps degrade; say so on the human path too, not
    // just --json. A silent skip would read as "no such tool".
    if (skipped.length > 0) {
      yield* Console.log(`skipped ${skipped.length}: ${skipped.map((s) => s.session).join(", ")}`)
    }
    return yield* Effect.void
  })
