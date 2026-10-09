import { Console, Effect } from "effect"
import { registerSessionTool } from "../sessions/verbs.ts"
import { UsageError, asCliFailure } from "../failure.ts"
import { INVOKE_TIMEOUT_MS, INVOKE_TIMEOUT_MAX_MS } from "../budgets.ts"

// register <handle> '<json-tool>' '<js-body>' [--timeout ms 1-INVOKE_TIMEOUT_MAX_MS] [--json]: thin argv shell
// over verbs.registerSessionTool; printing only here. The tool record
// is data (name/title/description/schema/annotations); the body is a
// function-expression source string.
export const register = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let handle: string | undefined
    let rawTool: string | undefined
    let code: string | undefined
    let timeoutMs = INVOKE_TIMEOUT_MS
    let json = false
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === "--json") {
        json = true
      } else if (arg === "--timeout") {
        const raw = args[++i]
        timeoutMs = Number(raw)
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > INVOKE_TIMEOUT_MAX_MS) {
          return yield* Effect.fail(new UsageError({ message: `register: bad --timeout '${raw ?? "(missing)"}': want 1-${INVOKE_TIMEOUT_MAX_MS} ms` }))
        }
      } else if (arg.startsWith("-")) {
        return yield* Effect.fail(new UsageError({ message: `register: unknown flag '${arg}'. Usage: register <handle> '<json-tool>' '<js-body>' [--timeout ms 1-${INVOKE_TIMEOUT_MAX_MS}] [--json]` }))
      } else if (handle === undefined) {
        handle = arg
      } else if (rawTool === undefined) {
        rawTool = arg
      } else if (code === undefined) {
        code = arg
      } else {
        return yield* Effect.fail(new UsageError({ message: `register: unexpected argument '${arg}'.` }))
      }
    }
    if (handle === undefined || rawTool === undefined || code === undefined) {
      return yield* Effect.fail(new UsageError({ message: `register: missing <handle>, '<json-tool>' or '<js-body>'. Usage: register <handle> '<json-tool>' '<js-body>' [--timeout ms 1-${INVOKE_TIMEOUT_MAX_MS}] [--json]` }))
    }
    let tool: unknown
    try {
      tool = JSON.parse(rawTool)
    } catch {
      return yield* Effect.fail(new UsageError({ message: "register: tool record is not JSON." }))
    }
    if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
      return yield* Effect.fail(new UsageError({ message: "register: tool record must be a JSON object." }))
    }
    const rec = tool as Record<string, unknown>
    if (typeof rec.name !== "string" || typeof rec.description !== "string") {
      return yield* Effect.fail(new UsageError({ message: "register: tool record needs string name + description." }))
    }
    if (typeof rec.inputSchema !== "object" || rec.inputSchema === null || Array.isArray(rec.inputSchema)) {
      return yield* Effect.fail(new UsageError({ message: "register: tool record needs an inputSchema object." }))
    }
    const result = yield* registerSessionTool(handle, {
      name: rec.name,
      ...(typeof rec.title === "string" ? { title: rec.title } : {}),
      description: rec.description,
      inputSchema: rec.inputSchema as Record<string, unknown>,
      ...(typeof rec.annotations === "object" && rec.annotations !== null && !Array.isArray(rec.annotations)
        ? { annotations: rec.annotations as Record<string, unknown> }
        : {}),
      code
    }, timeoutMs)
    if (json) {
      yield* Console.log(JSON.stringify(result, null, 2))
      return yield* Effect.void
    }
    yield* Console.log(`registered ${result.tool} on ${handle} (origin: ${result.origin}, untrusted)`)
    return yield* Effect.void
  }).pipe(
    Effect.catchTag("TransportFailed", (f) => Effect.fail(asCliFailure(f)))
  )
