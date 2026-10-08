// Manual eval for the WebMCP transport. Needs network + chromium.
// Usage: `bun run eval:transport`. Not run in CI (no browser there).
// Three evals, zero tokens: bad endpoint, unflagged 152, live list+invoke.
import { Console, Effect, Schema } from "effect"
import { dial, attachPage, navigate, collectTools, invokeTool, closePage } from "../src/transport/client.ts"
import type { Connection } from "../src/transport/client.ts"
import { launchChromium } from "../src/transport/launch.ts"
import { TransportFailed } from "../src/transport/errors.ts"

const DEMO = "https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/"

const reasonOf = (e: unknown): string => (e instanceof TransportFailed ? e.reason : `NOT-TRANSPORT: ${String(e)}`)

const WsVersion = Schema.Struct({ webSocketDebuggerUrl: Schema.String })

const wsUrl = Effect.fn("eval.wsUrl")(function* (httpEndpoint: string) {
  const raw = yield* Effect.tryPromise(
    () => fetch(`${httpEndpoint}/json/version`).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return { json: await r.json(), http: "ok" as const }
    })
  ).pipe(Effect.catch((cause) => Effect.succeed({ json: null, http: String(cause) })))
  const decoded = yield* Schema.decodeUnknownEffect(WsVersion)(raw.json).pipe(
    Effect.mapError(() => new TransportFailed({
      reason: "no-browser",
      operation: "eval.wsUrl",
      message: `${httpEndpoint}/json/version unusable (${raw.http}): the browser died between launch and version check`,
      fix: "kill any strays on the port and retry; if it repeats, the launch flags are crashing the browser."
    }))
  )
  return decoded.webSocketDebuggerUrl
})

// Scoped connection: the socket closes when the use ends, however it ends.
const withConn = Effect.fn("eval.withConn")(function* <A, E>(
  endpoint: string,
  use: (conn: Connection) => Effect.Effect<A, E>
) {
  const conn = yield* dial(endpoint, 5000)
  return yield* Effect.ensuring(use(conn), conn.close)
})

const evalBadEndpoint = Effect.fn("eval.badEndpoint")(function* () {
  const failure = yield* dial("ws://127.0.0.1:1/nope", 1000).pipe(Effect.flip)
  yield* Console.log(`eval1 bad-endpoint -> reason=${reasonOf(failure)} (want no-browser)`)
  return reasonOf(failure) === "no-browser"
})

const evalTwoPages = Effect.fn("eval.twoPages")(function* () {
  const browser = yield* launchChromium(9444)
  return yield* Effect.ensuring(
    withConn(yield* wsUrl(browser.httpEndpoint), (conn) =>
      Effect.gen(function* () {
        // Two pages, one connection: session-filtering must keep their
        // catalogs apart (unit-tested on a stub; proven live here).
        // Per-page order matters: each page's tools register during ITS
        // collect window — a later window never replays them. (Sessions
        // fix this by holding the subscription open from attach.)
        const a = yield* attachPage(conn)
        yield* navigate(conn, a.sessionId, DEMO)
        const toolsA = yield* collectTools(conn, a.sessionId, 4000)
        const b = yield* attachPage(conn)
        yield* navigate(conn, b.sessionId, DEMO)
        const toolsB = yield* collectTools(conn, b.sessionId, 4000)
        yield* Console.log(`eval2 two-pages -> A=[${toolsA.map((t) => t.name).join(",")}] B=[${toolsB.map((t) => t.name).join(",")}]`)
        const framesDiffer = toolsA.some((t) =>
          t.name === "searchFlights" &&
          toolsB.some((u) => u.name === "searchFlights" && u.frameId !== t.frameId)
        )
        yield* closePage(conn, a.targetId)
        yield* closePage(conn, b.targetId)
        return framesDiffer
      })),
    browser.close
  )
})

const evalLive = Effect.fn("eval.live")(function* () {
  const browser = yield* launchChromium(9333)
  return yield* Effect.ensuring(
    withConn(yield* wsUrl(browser.httpEndpoint), (conn) =>
      Effect.gen(function* () {
        const page = yield* attachPage(conn)
        yield* navigate(conn, page.sessionId, DEMO)
        const tools = yield* collectTools(conn, page.sessionId, 4000)
        yield* Console.log(`eval3 live -> tools=[${tools.map((t) => t.name).join(", ")}]`)
        const search = tools.find((t) => t.name === "searchFlights")
        if (search === undefined) {
          yield* Console.log("eval3 live -> searchFlights absent (want present)")
          return false
        }
        const result = yield* invokeTool(conn, page.sessionId, {
          frameId: search.frameId,
          toolName: "searchFlights",
          args: { origin: "SFO", destination: "JFK" }
        })
        yield* Console.log(`eval3 live -> status=${result.status} (want Completed)`)
        // The catalog keeps moving after a search (per-state registration):
        // the post-search surface must include the results tools.
        const after = yield* collectTools(conn, page.sessionId, 4000)
        yield* Console.log(`eval3 live -> after=[${after.map((t) => t.name).join(", ")}]`)
        const reshaped = after.some((t) => t.name === "listFlights")
        yield* Console.log(`eval3 live -> stats=${JSON.stringify(conn.stats)}`)
        yield* closePage(conn, page.targetId)
        return result.status === "Completed" && reshaped
      })),
    browser.close
  )
})

// Edge pattern (mirrors src/main.ts): settle via runPromiseExit, exit past
// the edge — never process.exit inside the runtime.
const main = Effect.fn("eval.main")(function* () {
  const results = [
    ["bad-endpoint", yield* evalBadEndpoint()],
    ["two-pages", yield* evalTwoPages()],
    ["live", yield* evalLive()]
  ] as const
  for (const [name, ok] of results) yield* Console.log(`${ok ? "PASS" : "FAIL"} ${name}`)
  return results.every(([, ok]) => ok) ? 0 : 1
})

const exit = await Effect.runPromiseExit(main().pipe(
  Effect.catch((e) => Console.error(
    `EVAL CRASH: ${e instanceof TransportFailed ? `${e.reason} ${e.operation}: ${e.message} :: ${e.fix ?? "no fix"}` : Bun.inspect(e)}`
  ).pipe(Effect.as(1)))
))
process.exit(exit._tag === "Success" ? exit.value : 1)
