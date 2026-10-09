// Transport: CDP over Bun's native WebSocket. Nothing above this module
// knows CDP; everything above speaks Connection. Raw protocol handling
// (id routing, session multiplexing, event dispatch) lives here because
// no thin library earns it — chrome-remote-interface drags its own `ws`
// and a callback legacy; this file is the moat, kept small on purpose.
import { Duration, Effect, Schema } from "effect"
import type { Protocol } from "devtools-protocol"
import { TransportFailed } from "./errors.ts"

export interface CdpConnection {
  readonly send: (
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string
  ) => Effect.Effect<unknown, TransportFailed>
  readonly onEvent: (
    method: string,
    handler: (params: unknown, sessionId?: string) => void
  ) => Effect.Effect<void>
  readonly close: Effect.Effect<void>
}

const dead = (operation: string): TransportFailed =>
  new TransportFailed({
    reason: "connect",
    operation,
    message: "browser socket is closed",
    fix: "the browser went away — open again.",
  })

interface CdpReply {
  readonly id?: number
  readonly method?: string
  readonly params?: unknown
  readonly sessionId?: string
  readonly result?: unknown
  readonly error?: { readonly message?: string }
}

export const connect = (wsUrl: string): Effect.Effect<CdpConnection, TransportFailed> =>
  Effect.callback<CdpConnection, TransportFailed>((resume) => {
    let nextId = 1
    let alive = false
    const pending = new Map<number, (result: Effect.Effect<unknown, TransportFailed>) => void>()
    const listeners = new Map<string, Array<(params: unknown, sessionId?: string) => void>>()
    let socket: WebSocket
    try {
      socket = new WebSocket(wsUrl)
    } catch (err) {
      resume(
        Effect.fail(
          new TransportFailed({
            reason: "connect",
            operation: "connect",
            message: `cannot open ${wsUrl}: ${err instanceof Error ? err.message : String(err)}`,
            fix: "is the debugging port open? launch a browser first.",
          })
        )
      )
      return
    }
    const failAll = (failure: TransportFailed): void => {
      for (const resumeSend of pending.values()) resumeSend(Effect.fail(failure))
      pending.clear()
    }
    socket.onopen = () => {
      alive = true
      const send = (
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string
      ): Effect.Effect<unknown, TransportFailed> =>
        Effect.callback<unknown, TransportFailed>((resumeSend) => {
          if (!alive) {
            resumeSend(Effect.fail(dead(method)))
            return
          }
          const id = nextId++
          pending.set(id, resumeSend)
          socket.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }))
        })
      const onEvent = (method: string, handler: (params: unknown, sessionId?: string) => void): Effect.Effect<void> =>
        Effect.sync(() => {
          const list = listeners.get(method) ?? []
          list.push(handler)
          listeners.set(method, list)
        })
      const close: Effect.Effect<void> = Effect.sync(() => {
        alive = false
        try {
          socket.close()
        } catch {
          // Already gone — close is best-effort by contract.
        }
        failAll(dead("close"))
      })
      resume(Effect.succeed({ send, onEvent, close }))
    }
    socket.onerror = () => {
      if (!alive) {
        resume(
          Effect.fail(
            new TransportFailed({
              reason: "connect",
              operation: "connect",
              message: `cannot open ${wsUrl}`,
              fix: "is the debugging port open? launch a browser first.",
            })
          )
        )
      }
    }
    socket.onmessage = (event) => {
      let reply: CdpReply
      try {
        reply = JSON.parse(String(event.data)) as CdpReply
      } catch {
        return
      }
      if (reply.id !== undefined) {
        const resumeSend = pending.get(reply.id)
        if (resumeSend === undefined) return
        pending.delete(reply.id)
        if (reply.error !== undefined) {
          resumeSend(
            Effect.fail(
              new TransportFailed({
                reason: "page",
                operation: "cdp",
                message: String(reply.error.message ?? "unknown CDP error"),
                fix: "the page refused the call — retry once, then report.",
              })
            )
          )
        } else {
          resumeSend(Effect.succeed(reply.result))
        }
        return
      }
      if (reply.method !== undefined) {
        for (const handler of listeners.get(reply.method) ?? []) handler(reply.params, reply.sessionId)
      }
    }
    socket.onclose = () => {
      alive = false
      failAll(dead("socket"))
    }
  })

// Bounded send: every CDP dial carries a timeout, so a wedged browser
// fails the call instead of hanging the fiber.
export const sendBounded = (
  conn: CdpConnection,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  sessionId?: string
): Effect.Effect<unknown, TransportFailed> => {
  const onTimeout = new TransportFailed({
    reason: "timeout",
    operation: method,
    message: `no reply in ${timeoutMs}ms`,
    fix: "the page is wedged or gone — list again, then retry once.",
  })
  return conn.send(method, params, sessionId).pipe(
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.catchTag("TimeoutError", () => Effect.fail(onTimeout))
  )
}

// Wire decode: unknown CDP JSON against a schema. asserts throws a
// SchemaError on mismatch; try/catch maps it to TransportFailed with
// the operation named, so the stranger knows what broke where.
const decodeWire = <A>(
  schema: Schema.Schema<A>,
  operation: string,
  what: string
): ((input: unknown) => Effect.Effect<A, TransportFailed>) =>
(input: unknown) =>
  Effect.try({
    try: () => {
      Schema.asserts(schema, input)
      return input
    },
    catch: (err) =>
      new TransportFailed({
        reason: "decode",
        operation,
        message: `${what}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
        fix: "the browser answered outside the CDP shape — check the version floor.",
      }),
  })
const EvalReply = Schema.Struct({
  result: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      value: Schema.Unknown,
    })
  ),
  exceptionDetails: Schema.optional(Schema.Unknown),
})

export const evaluateJson = (
  conn: CdpConnection,
  expression: string,
  timeoutMs: number,
  sessionId?: string
): Effect.Effect<unknown, TransportFailed> =>
  Effect.gen(function* () {
    const raw = (yield* sendBounded(
      conn,
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true } satisfies Protocol.Runtime.EvaluateRequest,
      timeoutMs,
      sessionId
    )) as unknown
    const reply = yield* decodeWire(EvalReply, "Runtime.evaluate", "CDP reply is not an evaluate result")(raw)
    if (reply.exceptionDetails !== undefined) {
      return yield* Effect.fail(
        new TransportFailed({
          reason: "page",
          operation: "Runtime.evaluate",
          message: `page threw: ${JSON.stringify(reply.exceptionDetails).slice(0, 300)}`,
          fix: "the page's own script failed — report the expression.",
        })
      )
    }
    return reply.result?.value
  })

// Browser websocket discovery: /json/version names the endpoint.
// Transport owns all CDP-adjacent IO, so this lives here, not in sessions.
const VersionReply = Schema.Struct({ webSocketDebuggerUrl: Schema.String })

export const discoverWs = (httpEndpoint: string, timeoutMs: number): Effect.Effect<string, TransportFailed> =>
  Effect.gen(function* () {
    const raw: unknown = yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch(`${httpEndpoint}/json/version`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as unknown
      },
      catch: (err) =>
        new TransportFailed({
          reason: "connect",
          operation: "discoverWs",
          message: `no debugger at ${httpEndpoint}: ${err instanceof Error ? err.message : String(err)}`,
          fix: "launch a browser first, or check the port.",
        }),
    })
    return yield* decodeWire(VersionReply, "discoverWs", "version reply names no debugger endpoint")(raw).pipe(
      Effect.map((reply) => reply.webSocketDebuggerUrl)
    )
  })

// Page tools per the WebMCP shape: name/description/inputSchema, optional
// annotations. readOnlyHint normalizes to readOnly (verified live).
const WireTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  annotations: Schema.optional(
    Schema.Struct({
      readOnly: Schema.optional(Schema.Boolean),
      readOnlyHint: Schema.optional(Schema.Boolean),
    })
  ),
})

export interface PageTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly annotations: { readonly readOnly?: boolean }
}

const WireTools = Schema.Array(WireTool)

export const listPageTools = (
  conn: CdpConnection,
  timeoutMs: number,
  sessionId?: string
): Effect.Effect<ReadonlyArray<PageTool>, TransportFailed> =>
  Effect.gen(function* () {
    const value = yield* evaluateJson(
      conn,
      "(async () => JSON.stringify(await document.modelContext.getTools()))()",
      timeoutMs,
      sessionId
    )
    if (typeof value !== "string") {
      return yield* Effect.fail(
        new TransportFailed({
          reason: "decode",
          operation: "listPageTools",
          message: "page returned no tool JSON (modelContext missing?)",
          fix: "the page exposes no WebMCP surface — not an error, just empty.",
        })
      )
    }
    const parsed: unknown = yield* Effect.try({
      try: () => JSON.parse(value) as unknown,
      catch: () =>
        new TransportFailed({
          reason: "decode",
          operation: "listPageTools",
          message: "tool JSON is unparseable",
          fix: "the page's tool catalog is malformed.",
        }),
    })
    const tools = yield* decodeWire(WireTools, "listPageTools", "tool catalog shape broke")(parsed)
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      annotations:
        tool.annotations?.readOnly ?? tool.annotations?.readOnlyHint !== undefined
          ? { readOnly: tool.annotations.readOnly ?? tool.annotations.readOnlyHint }
          : {},
    }))
  })
