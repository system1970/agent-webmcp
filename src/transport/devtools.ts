import { Effect, Schema } from "effect"
import { TransportFailed } from "./errors.ts"

// DevTools HTTP helpers: the ws endpoint and target list behind an
// http://host:port browser. Every failure here is no-browser — HTTP is
// only ever the front door to a browser we expect to be up.
const Version = Schema.Struct({ webSocketDebuggerUrl: Schema.String })

const Target = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  url: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String)
})

// One shared front-door budget: DevTools HTTP hangs are browser hangs
// (a hung endpoint stalls the verb forever otherwise). Timeouts and HTTP
// errors fail no-browser; the BODY is returned raw so callers classify
// shape failures as protocol — a live-but-garbled endpoint (captive
// portal, wrong service) must never report "no browser".
export const fetchText = Effect.fn("devtools.fetchText")(function* (url: string, timeoutMs = 5000) {
  return yield* Effect.tryPromise(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }).pipe(Effect.mapError(() => new TransportFailed({
    reason: "no-browser",
    operation: "devtools",
    message: `${url} unreachable within ${timeoutMs}ms: no browser answers there`,
    fix: "launch one (open without --cdp) or point --cdp at a live DevTools HTTP endpoint."
  })))
})

const getJson = Effect.fn("devtools.getJson")(function* (url: string) {
  const text = yield* fetchText(url)
  return yield* Effect.tryPromise(() => Promise.resolve(JSON.parse(text))).pipe(
    Effect.mapError(() => new TransportFailed({
      reason: "protocol",
      operation: "devtools",
      message: `${url} answered non-JSON: not a DevTools endpoint`,
      fix: "point --cdp at a Chromium DevTools HTTP endpoint (http://host:port)."
    }))
  )
})

export const browserWs = Effect.fn("devtools.browserWs")(function* (httpEndpoint: string) {
  const raw = yield* getJson(`${httpEndpoint}/json/version`)
  return yield* Schema.decodeUnknownEffect(Version)(raw).pipe(
    Effect.mapError(() => new TransportFailed({
      reason: "protocol",
      operation: "devtools",
      message: `${httpEndpoint}/json/version answered outside its shape`,
      fix: "that endpoint is not a Chromium DevTools HTTP service."
    }))
  ).pipe(Effect.map((v) => v.webSocketDebuggerUrl))
})

export interface PageTarget {
  readonly id: string
  readonly url: string
  readonly title: string
}

export const pageTargets = Effect.fn("devtools.pageTargets")(function* (httpEndpoint: string) {
  const raw = (yield* getJson(`${httpEndpoint}/json/list`)) as unknown
  if (!Array.isArray(raw)) {
    return yield* Effect.fail(new TransportFailed({
      reason: "protocol",
      operation: "devtools",
      message: `${httpEndpoint}/json/list answered outside its shape`,
      fix: "that endpoint is not a Chromium DevTools HTTP service."
    }))
  }
  const pages: Array<PageTarget> = []
  for (const entry of raw) {
    try {
      const t = Schema.decodeUnknownSync(Target)(entry)
      if (t.type === "page") pages.push({ id: t.id, url: t.url ?? "", title: t.title ?? "" })
    } catch {}
  }
  return pages
})
