import { Console, Effect } from "effect"
import { listSessionTools } from "../sessions/verbs.ts"
import { UsageError, CliFailure, asCliFailure } from "../failure.ts"

// list <handle> [tool] [--json]: stat-like rows for the session's tools.
// Thin argv shell over verbs.listSessionTools; printing only here.
export const list = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let handle: string | undefined
    let tool: string | undefined
    let json = false
    for (const arg of args) {
      if (arg === "--json") {
        json = true
      } else if (arg.startsWith("-")) {
        return yield* Effect.fail(new UsageError({ message: `list: unknown flag '${arg}'. Usage: list <handle> [tool] [--json]` }))
      } else if (handle === undefined) {
        handle = arg
      } else if (tool === undefined) {
        tool = arg
      } else {
        return yield* Effect.fail(new UsageError({ message: `list: unexpected argument '${arg}'. Usage: list <handle> [tool] [--json]` }))
      }
    }
    if (handle === undefined) {
      return yield* Effect.fail(new UsageError({ message: "list: missing <handle>. Usage: list <handle> [tool] [--json]" }))
    }
    const h = handle
    const want = tool
    const catalog = yield* listSessionTools(h)
    const tools = catalog.tools
    if (want !== undefined) {
      const found = tools.find((t) => t.name === want)
      if (found === undefined) {
        return yield* Effect.fail(new CliFailure({
          message: `unknown tool '${want}' on ${h}` +
            (tools.length > 0 ? ` (available: ${tools.map((t) => t.name).join(", ")})` : " (the page publishes nothing)") +
            ` :: run \`list ${h}\` to refresh (tools register per page state).`
        }))
      }
      yield* Console.log(JSON.stringify(
        { name: found.name, description: found.description, inputSchema: found.inputSchema ?? {}, annotations: found.annotations, frameId: found.frameId, origin: catalog.url, untrusted: true },
        null,
        2
      ))
      return yield* Effect.void
    }
    if (json) {
      yield* Console.log(JSON.stringify(
        { handle: h, url: catalog.url, untrusted: true, tools },
        null,
        2
      ))
      return yield* Effect.void
    }
    if (tools.length === 0) {
      yield* Console.log(`no tools: ${catalog.url} publishes nothing (not an error — the page exposes no tools)`)
      return yield* Effect.void
    }
    for (const t of tools) {
      // Bits print only what the page claims: absent annotations claim
      // nothing (never default to capability).
      const bits = [
        t.annotations.readOnly === true ? "read-only" : undefined,
        t.annotations.untrustedContent === true ? "untrusted-output" : undefined
      ].filter((b) => b !== undefined).join(" ")
      const schemaSize = JSON.stringify(t.inputSchema ?? {}).length
      const suffix = bits !== "" ? ` [${bits}]` : ""
      yield* Console.log(`${t.name} — ${t.description || "(no description)"}${suffix} (~${schemaSize}B schema)`)
    }
    return yield* Effect.void
  }).pipe(
    Effect.catchTag("TransportFailed", (f) => Effect.fail(asCliFailure(f)))
  )
