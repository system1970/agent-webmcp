import { Console, Duration, Effect, Schema } from "effect"
import { TransportFailed, webmcpFloorFix } from "./errors.ts"

// A tool the page publishes. Field shapes mirror the live CDP WebMCP domain
// (verified against Chromium 152 via /json/protocol): annotations carry
// readOnly/untrustedContent/autosubmit. Note what is absent: this build has
// no consequentialHint — never assume docs match the browser, probe it.
export interface PageTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown> | undefined
  readonly annotations: {
    readonly readOnly?: boolean
    readonly untrustedContent?: boolean
    readonly autosubmit?: boolean
  }
  readonly frameId: string
}

export type InvocationStatus = "Completed" | "Canceled" | "Error"

export interface InvocationResult {
  readonly status: InvocationStatus
  // Page-provided and untrusted by definition — the protocol itself says the
  // output "poses a prompt injection risk". Render delimited with origin,
  // never as instructions.
  readonly output: unknown
  readonly errorText: string | undefined
}

export type CdpListener = (method: string, params: unknown, sessionId: string | undefined) => void

// Frame-level diagnostics. Malformed frames and throwing listeners are
// counted, never fatal: one bad frame must not kill a live session, but
// the evidence must not disappear either. Read via conn.stats.
export interface ConnStats {
  readonly malformedFrames: number
  readonly listenerErrors: number
}

// One CDP connection. `call` is the fallible work (an Effect); `subscribe`
// is sync wiring — adding a listener to a set, like constructing the
// object. Both the registration AND the listener body run outside the
// runtime (CDP calls back on its own); keep listener bodies to sync
// state moves (map swaps, resume calls) and let the Effects built on top
// carry the fallibility.
export interface Connection {
  readonly endpoint: string
  readonly call: (
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number
  ) => Effect.Effect<unknown, TransportFailed>
  readonly subscribe: (listener: CdpListener) => () => void
  readonly stats: ConnStats
  readonly close: Effect.Effect<void>
}

const TargetCreated = Schema.Struct({ targetId: Schema.String })
const SessionAttached = Schema.Struct({ sessionId: Schema.String })
const WireAnnotations = Schema.Struct({
  readOnly: Schema.optional(Schema.Boolean),
  untrustedContent: Schema.optional(Schema.Boolean),
  autosubmit: Schema.optional(Schema.Boolean)
})

const WireTool = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  annotations: Schema.optional(WireAnnotations),
  // Present on CDP toolsAdded events, absent from the page surface
  // (snapshotTools attributes the main frame). Merge quarantines
  // frameless entries; snapshot fills them.
  frameId: Schema.optional(Schema.String)
})

const ToolsEnvelope = Schema.Struct({ tools: Schema.Array(Schema.Unknown) })
const ToolRemoval = Schema.Struct({ name: Schema.String, frameId: Schema.String })
const InvokeReply = Schema.Struct({ invocationId: Schema.String })

const ToolResponded = Schema.Struct({
  invocationId: Schema.String,
  status: Schema.Literals(["Completed", "Canceled", "Error"]),
  output: Schema.optional(Schema.Unknown),
  errorText: Schema.optional(Schema.String)
})

const decodeFailed = (operation: string, expected: string, issue: unknown): TransportFailed =>
  new TransportFailed({
    reason: "protocol",
    operation,
    message: `browser answered outside ${expected} for ${operation}: ${String(issue)}`
  })

interface Pending {
  readonly resolve: (reply: CdpReply) => void
  readonly reject: (failure: TransportFailed) => void
}

interface CdpReply {
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string }
}

// Dial a CDP websocket endpoint (ws://.../devtools/...). Fails no-browser
// with the launch line when nothing listens.
export const dial = Effect.fn("transport.dial")(function* (endpoint: string, timeoutMs = 5000) {
  const open = (url: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        reject(new Error("websocket constructor threw"))
        return
      }
      const timer = setTimeout(() => {
        try {
          ws.close()
        } catch {}
        reject(new Error("open timeout"))
      }, timeoutMs)
      ws.onopen = () => {
        clearTimeout(timer)
        resolve(ws)
      }
      ws.onclose = () => {
        clearTimeout(timer)
        reject(new Error("socket closed before open"))
      }
    })

  // Interruption-safety note: after `open` resolves, everything to
  // `return` is synchronous map/handler setup — Effect interrupts land on
  // yield points, so no interrupt can interleave here. `open` self-cleans
  // on timeout via its timer. No Scope machinery is owed for this gap.
  const socket = yield* Effect.tryPromise({
    try: () => open(endpoint),
    catch: () => new TransportFailed({
      reason: "no-browser",
      operation: "dial",
      message: `nothing listens at ${endpoint}`,
      fix: "launch chromium first (any of: chromium, google-chrome, google-chrome-stable), headless with --remote-debugging-port=<PORT>, or attach to a running one via its ws endpoint. CHROMIUM_PATH overrides the search."
    })
  })

  let nextId = 1
  const pending = new Map<number, Pending>()
  const listeners = new Set<CdpListener>()
  // Mutable inside, readonly outside: the interface exposes ConnStats with
  // readonly fields, so callers can read diagnostics but not rewrite them.
  const counters = { malformedFrames: 0, listenerErrors: 0 }

  yield* Effect.sync(() => {
    socket.onmessage = (ev) => {
    let msg: { id?: number; method?: string; params?: unknown; sessionId?: string; result?: unknown; error?: { code: number; message: string } }
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      counters.malformedFrames++
      return
    }
    if (msg.id !== undefined) {
      const p = pending.get(msg.id)
      if (p !== undefined) {
        pending.delete(msg.id)
        p.resolve(msg)
      }
      return
    }
    if (msg.method !== undefined) {
      for (const listener of listeners) {
        try {
          listener(msg.method, msg.params, msg.sessionId)
        } catch {
          counters.listenerErrors++
        }
      }
    }
  }
  socket.onclose = () => {
    const failure = new TransportFailed({
      reason: "protocol",
      operation: "socket",
      message: "browser closed the connection mid-session",
      fix: "re-dial and re-attach: sessions do not survive socket death."
    })
    for (const entry of [...pending.values()]) entry.reject(failure)
    pending.clear()
  }
  })

  const call = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMsCall = 10000
  ): Effect.Effect<unknown, TransportFailed> =>
    Effect.callback<unknown, TransportFailed>((resume) => {
      const settle = (reply: CdpReply) => {
        if (reply.error !== undefined) {
          resume(Effect.fail(new TransportFailed({
            reason: "protocol",
            operation: method,
            message: `browser refused ${method}: ${reply.error.message}`,
            code: reply.error.code
          })))
          return
        }
        resume(Effect.succeed(reply.result))
      }
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        resume(Effect.fail(new TransportFailed({
          reason: "timeout",
          operation: method,
          message: `${method} unanswered after ${timeoutMsCall}ms`,
          fix: "the browser may be wedged: close the page and re-attach. If this repeats, raise the timeout."
        })))
      }, timeoutMsCall)
      pending.set(id, {
        resolve: (reply) => {
          clearTimeout(timer)
          settle(reply as { result?: unknown; error?: { code: number; message: string } })
        },
        reject: (failure) => {
          clearTimeout(timer)
          resume(Effect.fail(failure))
        }
      })
      try {
        socket.send(JSON.stringify(
          sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }
        ))
      } catch {
        pending.delete(id)
        clearTimeout(timer)
        resume(Effect.fail(new TransportFailed({
          reason: "protocol",
          operation: method,
          message: "socket send threw: the connection is dead"
        })))
      }
      return Effect.sync(() => {
        clearTimeout(timer)
        pending.delete(id)
      })
    })

  const subscribe = (listener: CdpListener): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const close: Effect.Effect<void> = Effect.sync(() => {
    try {
      socket.close()
    } catch {}
  })

  return { endpoint, call, subscribe, get stats(): ConnStats { return counters }, close }
})

// Attach to a page target: create it, bind a flattened session, enable the
// page + WebMCP domains. Note the trap: WebMCP.enable answers {} even on
// flagless browsers (tools just never arrive). The honest flags signal is
// probePageSupport on a real page — open refuses flags-missing
// there, not here.
export const attachPage = Effect.fn("transport.attachPage")(function* (
  conn: Connection,
  url = "about:blank"
) {
  const created = yield* Schema.decodeUnknownEffect(TargetCreated)(
    yield* conn.call("Target.createTarget", { url })
  ).pipe(Effect.mapError((issue) => decodeFailed("Target.createTarget", "{targetId}", issue)))
  const targetId = created.targetId
  const attached = yield* Schema.decodeUnknownEffect(SessionAttached)(
    yield* conn.call("Target.attachToTarget", { targetId, flatten: true })
  ).pipe(Effect.mapError((issue) => decodeFailed("Target.attachToTarget", "{sessionId}", issue)))
  const sessionId = attached.sessionId
  yield* enableSession(conn, sessionId)
  return { targetId, sessionId }
})

// One place for the per-session enable pair (attach + reattach share it).
const enableSession = Effect.fn("transport.enableSession")(function* (
  conn: Connection,
  sessionId: string
) {
  yield* conn.call("Page.enable", {}, sessionId)
  yield* enableWebMcp(conn, sessionId)
})

// Enable the WebMCP domain on a session. Older builds answer -32601
// (method not found): below the floor, with the floor fix attached.
const enableWebMcp = Effect.fn("transport.enableWebMcp")(function* (
  conn: Connection,
  sessionId: string
) {
  yield* conn.call("WebMCP.enable", {}, sessionId).pipe(
    Effect.catch((failure) => {
      if (failure instanceof TransportFailed && failure.code === -32601) {
        return Effect.fail(new TransportFailed({
          reason: "flags-missing",
          operation: "WebMCP.enable",
          message: `browser does not speak the WebMCP domain: ${failure.message}`,
          fix: webmcpFloorFix
        }))
      }
      return Effect.fail(failure)
    })
  )
})

// Reattach to a recorded target: the session behind a persisted handle.
// A fresh flattened session each call (sessionIds die with the socket).
// Attach-phase failure means one thing: the target is gone (closed,
// navigated-away container, browser restarted) — reason navigated, never
// a generic protocol shrug.
export const reattach = Effect.fn("transport.reattach")(function* (
  conn: Connection,
  targetId: string
) {
  const raw = yield* conn.call("Target.attachToTarget", { targetId, flatten: true }).pipe(
    Effect.catch((failure) => Effect.fail(
      // Verified live: dead targets answer -32602 ("No target with given
      // id"). Anything else (timeout, socket death) is itself — rethrown.
      failure instanceof TransportFailed && failure.code === -32602
        ? new TransportFailed({
          reason: "navigated",
          operation: "Target.attachToTarget",
          message: `target ${targetId} is gone (closed, or its browser restarted)`,
          fix: "close the dead handle and open the page again."
        })
        : failure
    ))
  )
  const attached = yield* Schema.decodeUnknownEffect(SessionAttached)(raw).pipe(
    Effect.mapError((issue) => decodeFailed("Target.attachToTarget", "{sessionId}", issue))
  )
  const sessionId = attached.sessionId
  yield* enableSession(conn, sessionId)
  return { targetId, sessionId }
})
// Wait for one matching event. Interrupt-safe: the listener unregisters when
// the wait ends for any reason (match, timeout, interruption).
export const waitForEvent = Effect.fn("transport.waitForEvent")(function* (
  conn: Connection,
  match: (method: string, params: unknown) => boolean,
  timeoutMs = 30000,
  operation = "wait",
  // Flattened sessions tag every event with their sessionId. Pass it to
  // keep multi-page connections from satisfying each other's waits.
  sessionId?: string
) {
  return yield* Effect.callback<unknown, TransportFailed>((resume) => {
    const listener: CdpListener = (method, params, eventSession) => {
      if (sessionId !== undefined && eventSession !== sessionId) return
      if (match(method, params)) resume(Effect.succeed(params))
    }
    const unsubscribe = conn.subscribe(listener)
    return Effect.sync(() => unsubscribe())
  }).pipe(
    Effect.timeout(Duration.millis(timeoutMs)),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new TransportFailed({
        reason: "timeout",
        operation,
        message: `no matching event within ${timeoutMs}ms`,
        fix: "re-list: pages register tools late, and navigation resets the catalog."
      })))
  )
})

export const navigate = Effect.fn("transport.navigate")(function* (
  conn: Connection,
  sessionId: string,
  url: string,
  timeoutMs = 30000
) {
  yield* conn.call("Page.navigate", { url }, sessionId)
  yield* waitForEvent(
    conn,
    (method) => method === "Page.loadEventFired",
    timeoutMs,
    "Page.navigate",
    sessionId
  ).pipe(
    Effect.catch((failure) => {
      if (
        failure instanceof TransportFailed &&
        failure.reason === "timeout"
      ) {
        return Effect.fail(new TransportFailed({
          reason: "timeout",
          operation: failure.operation,
          message: `${url} never fired load within ${timeoutMs}ms (tools may still arrive: pages register late)`,
          fix: failure.fix
        }))
      }
      return Effect.fail(failure)
    })
  )
})

export interface MergeResult {
  readonly catalog: Map<string, PageTool>
  readonly quarantined: number
}

// Snapshot the page's current tools from the page surface. Proven live:
// WebMCP.enable does NOT backfill already-registered tools on a fresh
// session (reattached sessions see nothing), so a reattach must seed from
// document.modelContext directly. Events remain the live-update path.
const EvalSnapshot = Schema.Struct({
  result: Schema.Struct({ value: Schema.Unknown })
})

const FrameTree = Schema.Struct({
  frameTree: Schema.Struct({ frame: Schema.Struct({ id: Schema.String }) })
})

// Snapshot the page's current tools from the page surface. Proven live:
// WebMCP.enable does NOT backfill already-registered tools on a fresh
// session (reattached sessions see nothing), so a reattach must seed from
// document.modelContext directly. Events remain the live-update path —
// sessionTools merges both, events winning on name+frame.
export const snapshotTools = Effect.fn("transport.snapshotTools")(function* (
  conn: Connection,
  sessionId: string
) {
  const tree = yield* Schema.decodeUnknownEffect(FrameTree)(
    yield* conn.call("Page.getFrameTree", {}, sessionId)
  ).pipe(
    Effect.mapError((issue) => decodeFailed("Page.getFrameTree", "{frameTree.frame.id}", issue))
  )
  const mainFrame = tree.frameTree.frame.id
  const reply = yield* conn.call(
    "Runtime.evaluate",
    {
      // Await INSIDE: stringifying the bare promise yields "{}".
      expression: `(async () => { try {
        const tools = await document.modelContext.getTools()
        return JSON.stringify({ tools: tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema: typeof t.inputSchema === "string" ? JSON.parse(t.inputSchema) : (t.inputSchema ?? {}),
          annotations: t.annotations ?? {}
        })) })
      } catch (e) { return JSON.stringify({ error: String(e) }) } })()`,
      awaitPromise: true,
      returnByValue: true
    },
    sessionId
  )
  const evaluated = yield* Schema.decodeUnknownEffect(EvalSnapshot)(reply).pipe(
    Effect.mapError((issue) => decodeFailed("Runtime.evaluate", "{result.value}", issue))
  )
  if (typeof evaluated.result.value !== "string") {
    return yield* Effect.fail(decodeFailed("Runtime.evaluate", "JSON string", evaluated.result.value))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(evaluated.result.value)
  } catch {
    return yield* Effect.fail(decodeFailed("Runtime.evaluate", "JSON string", "unparseable"))
  }
  // Main-frame attribution: the page surface names no frames, and this
  // session reads the main frame. Iframe tools get the main frame id —
  // invoking one targets the wrong frame and the browser refuses as a
  // TransportFailed (exit 1), not page data. Live-subscription sessions
  // (daemon) carry true frameIds from toolsAdded.
  if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
    return yield* Effect.fail(new TransportFailed({
      reason: "flags-missing",
      operation: "snapshotTools",
      message: `page surface broken: ${String((parsed as { error: unknown }).error)}`,
      fix: webmcpFloorFix
    }))
  }
  const tools: Array<PageTool> = []
  let quarantined = 0
  if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { tools: unknown }).tools)) {
    for (const raw of (parsed as { tools: Array<unknown> }).tools) {
      try {
        const tool = Schema.decodeUnknownSync(WireTool)(raw)
        tools.push({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema,
          annotations: tool.annotations ?? {},
          frameId: mainFrame
        })
      } catch {
        quarantined++
      }
    }
  }
  if (quarantined > 0) {
    yield* Console.log(`transport: snapshot quarantined ${quarantined} malformed tool entries (skipped, catalog intact)`)
  }
  return tools
})

// Full catalog for a reattached session: seed from the surface, fold in
// whatever the live window catches (late registrants carry true frameIds
// and win on name+frame). Either source alone lies by omission.
export const sessionTools = Effect.fn("transport.sessionTools")(function* (
  conn: Connection,
  sessionId: string,
  windowMs = 2000
) {
  const seeded = yield* snapshotTools(conn, sessionId)
  const live = yield* collectTools(conn, sessionId, windowMs)
  const catalog = new Map<string, PageTool>()
  for (const tool of seeded) catalog.set(`${tool.frameId}::${tool.name}`, tool)
  for (const tool of live) catalog.set(`${tool.frameId}::${tool.name}`, tool)
  return [...catalog.values()]
})
// Merge one WebMCP toolsAdded/toolsRemoved event into the catalog. Pure.
// Policy twin to snapshotTools (which fills mainFrame): events CARRY
// frameIds, so a frameless event entry is corrupt data → quarantine.
// The surface NAMES no frames, so snapshot attribution is the only
// reading available. Same omission, opposite evidence — hence opposite
// defaults, both counted, never silent.
// Every entry is Schema-decoded; malformed entries are quarantined
// (skipped and counted), never keyed as `undefined::undefined`.
// Quarantine, not failure: this runs on a live subscription where one bad
// tool must not evict the verified catalog — but the count keeps the
// evidence (see ConnStats pattern for frames). Strict fail-protocol decode
// lives on the request paths (attach/invoke), where a malformed reply
// answers a question we asked. Keyed by name+frameId — the same tool name
// in two frames is two tools (cross-frame collisions are expected per spec).
export const mergeToolEvent = (
  catalog: ReadonlyMap<string, PageTool>,
  method: string,
  params: unknown
): MergeResult => {
  const next = new Map(catalog)
  let quarantined = 0
  try {
    // Envelope first, then each entry alone: one malformed tool skips
    // itself, never its well-formed siblings (Array decode is all-or-
    // nothing, which would let one bad tool evict fourteen good ones).
    if (method === "WebMCP.toolsAdded") {
      const { tools } = Schema.decodeUnknownSync(ToolsEnvelope)(params)
      for (const raw of tools) {
        try {
          const tool = Schema.decodeUnknownSync(WireTool)(raw)
          if (tool.frameId === undefined) {
            quarantined++
            continue
          }
          next.set(`${tool.frameId}::${tool.name}`, {
            name: tool.name,
            description: tool.description ?? "",
            inputSchema: tool.inputSchema,
            annotations: tool.annotations ?? {},
            frameId: tool.frameId
          })
        } catch {
          quarantined++
        }
      }
    } else if (method === "WebMCP.toolsRemoved") {
      const { tools } = Schema.decodeUnknownSync(ToolsEnvelope)(params)
      for (const raw of tools) {
        try {
          const tool = Schema.decodeUnknownSync(ToolRemoval)(raw)
          next.delete(`${tool.frameId}::${tool.name}`)
        } catch {
          quarantined++
        }
      }
    }
  } catch {}
  return { catalog: next, quarantined }
}

// Snapshot whatever the page exposes right now. Racy by design: enable
// replays current tools as toolsAdded, late registrants arrive after.
// Sessions fix this by holding the subscription open; here the window
// bounds the wait honestly instead of pretending completeness.
export const collectTools = Effect.fn("transport.collectTools")(function* (
  conn: Connection,
  sessionId: string,
  windowMs = 2000
) {
  // Append-only log outside the runtime; the fold back into a catalog runs
  // inside it. The listener never reads shared state, only appends.
  // Bounded: a chatty page can burst events, so past MAX_SEEN the oldest
  // are dropped and counted as quarantined — a snapshot, not an archive.
  const MAX_SEEN = 2000
  const seen: Array<{ method: string; params: unknown }> = []
  let dropped = 0
  const unsubscribe = yield* Effect.sync(() => conn.subscribe((method, params, eventSession) => {
    if (eventSession !== sessionId) return
    if (seen.length >= MAX_SEEN) {
      seen.shift()
      dropped++
    }
    seen.push({ method, params })
  }))
  yield* Effect.ensuring(
    Effect.sleep(Duration.millis(windowMs)),
    Effect.sync(() => unsubscribe())
  )
  let catalog = new Map<string, PageTool>()
  let quarantined = 0
  for (const event of seen) {
    const merged = mergeToolEvent(catalog, event.method, event.params)
    catalog = merged.catalog
    quarantined += merged.quarantined
  }
  if (quarantined + dropped > 0) {
    yield* Console.log(`transport: quarantined ${quarantined} malformed tool entries, dropped ${dropped} overflow events (skipped, catalog intact)`)
  }
  return [...catalog.values()]
})

// Invoke a page tool: send, await the terminal toolResponded for our
// invocationId, decode. A Completed-with-Error status is page data, not a
// transport failure — it returns as data. Only a stall fails, and a stall
// cancels first so the page is never left holding our call.
export const invokeTool = Effect.fn("transport.invokeTool")(function* (
  conn: Connection,
  sessionId: string,
  input: { frameId: string; toolName: string; args: Record<string, unknown> },
  timeoutMs = 30000
) {
  const reply = yield* conn.call(
    "WebMCP.invokeTool",
    { frameId: input.frameId, toolName: input.toolName, input: input.args },
    sessionId
  )
  const decoded = yield* Schema.decodeUnknownEffect(InvokeReply)(reply).pipe(
    Effect.mapError((issue) => decodeFailed("WebMCP.invokeTool", "{invocationId}", issue))
  )
  const invocationId = decoded.invocationId
  const params = yield* waitForEvent(
    conn,
    (method, eventParams) =>
      method === "WebMCP.toolResponded" &&
      typeof eventParams === "object" &&
      eventParams !== null &&
      (eventParams as { invocationId?: unknown }).invocationId === invocationId,
    timeoutMs,
    "WebMCP.invokeTool",
    sessionId
  ).pipe(
    Effect.catch((failure) => {
      if (failure instanceof TransportFailed && failure.reason === "timeout") {
        return conn.call("WebMCP.cancelInvocation", { invocationId }, sessionId).pipe(
          Effect.ignore,
          Effect.andThen(() => Effect.fail(new TransportFailed({
            reason: "timeout",
            operation: "WebMCP.invokeTool",
            message: `${input.toolName} produced no terminal response within ${timeoutMs}ms (cancel attempted)`,
            fix: "the page tool may hang on this input: retry with a smaller timeout, or re-list — the tool may have unregistered."
          })))
        )
      }
      return Effect.fail(failure)
    })
  )
  const result = yield* Schema.decodeUnknownEffect(ToolResponded)(params).pipe(
    Effect.mapError((issue) => decodeFailed("WebMCP.toolResponded", "{invocationId, status, output?}", issue))
  )
  const out: InvocationResult = {
    status: result.status,
    output: result.output,
    errorText: result.errorText
  }
  return out
})

// Does this page expose the WebMCP JS surface? The CDP domain enables even
// on flagless browsers (tools just never arrive), so a real page probe is
// the honest flags signal. Needs a real origin: about:blank answers
// undefined even with flags on.
const EvalResult = Schema.Struct({
  result: Schema.optional(Schema.Struct({ value: Schema.Unknown }))
})

export const probePageSupport = Effect.fn("transport.probePageSupport")(function* (
  conn: Connection,
  sessionId: string
) {
  const reply = yield* conn.call(
    "Runtime.evaluate",
    { expression: "typeof document.modelContext !== 'undefined'", returnByValue: true },
    sessionId
  )
  // A malformed evaluate reply is a protocol error, not a silent false:
  // false must mean "surface absent", never "reply unreadable".
  const decoded = yield* Schema.decodeUnknownEffect(EvalResult)(reply).pipe(
    Effect.mapError((issue) => decodeFailed("Runtime.evaluate", "{result: {value}}", issue))
  )
  return decoded.result?.value === true
})

// Best-effort by contract: closing a dead or already-closed target is not
// an error worth failing over. Callers needing certainty re-list.
export const closePage = Effect.fn("transport.closePage")(function* (
  conn: Connection,
  targetId: string
) {
  yield* conn.call("Target.closeTarget", { targetId }).pipe(
    Effect.catch(() => Effect.void)
  )
})
