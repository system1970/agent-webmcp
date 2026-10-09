// Sessions: open/close/list over disk handles. Browsers are owned per
// session (one browser, one page, one dir) — sharing comes later, if a
// unit ever needs it. Crash-safe: only the record persists; a dead
// browser is a transport failure on next verb, never a corrupt store.
import { Context, Effect, Layer } from "effect"
import { connect, discoverWs, listPageTools, sendBounded } from "../transport/client.ts"
import type { TransportFailed } from "../transport/errors.ts"
import { launchChromium, type Launched } from "../transport/launch.ts"
import { SessionStore, type SessionRecord } from "./store.ts"
import { StoreFailed } from "./errors.ts"

export const SESSION_ROOT = "/tmp/opencode/agent-webmcp-sessions"

// Browser seam: launch over owned Chromium. Exists so tests can
// substitute a fake (second implementation); production is launch.ts.
export interface BrowserApi {
  readonly launch: (port: number) => Effect.Effect<Launched, TransportFailed>
}

export class Browser extends Context.Service<Browser, BrowserApi>()("Browser", {}) {
  static readonly Live: Layer.Layer<Browser> = Layer.succeed(Browser, {
    launch: (port: number) => launchChromium(port),
  })
}

// Kill guard: SIGKILL only our own. A pid is ours when its /proc cmdline
// carries our user-data-dir marker. Anything else is never signaled.
export const PROFILE_MARKER = "agent-webmcp-chrome-"

export const isOurs = (pid: number): Effect.Effect<boolean> =>
  Effect.tryPromise({
    try: async () => {
      const cmd = await Bun.file(`/proc/${pid}/cmdline`).text()
      return cmd.replaceAll("\0", " ").includes(PROFILE_MARKER)
    },
    catch: (err) => err,
  }).pipe(Effect.orElseSucceed(() => false))

const findFreePort = Effect.fn("sessions.findFreePort")(function* () {
  for (let port = 9333; port < 9433; port++) {
    try {
      const probe = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } })
      probe.stop(true)
      return port
    } catch {
      continue
    }
  }
  return yield* Effect.fail(
    new StoreFailed({ reason: "no-port", message: "no free port in 9333-9432", fix: "close something first." })
  )
})

export interface Opened {
  readonly handle: string
  readonly url: string
  readonly toolCount: number
}

export const openSession = Effect.fn("sessions.openSession")(function* (url: string) {
  const store = yield* SessionStore
  const browser = yield* Browser
  const parsed = yield* Effect.try({
    try: () => new URL(url),
    catch: () => new StoreFailed({ reason: "bad-url", message: `not a URL: ${url.slice(0, 120)}`, fix: "pass an absolute http(s) URL." }),
  })
  const port = yield* findFreePort()
  const launched = yield* browser.launch(port)
  const run = Effect.gen(function* () {
    const wsUrl = yield* discoverWs(launched.httpEndpoint, 5000)
    const conn = yield* connect(wsUrl)
    try {
      const created = (yield* sendBounded(conn, "Target.createTarget", { url }, 10000)) as { targetId: string }
      const attached = (yield* sendBounded(conn, "Target.attachToTarget", { targetId: created.targetId, flatten: true }, 10000)) as {
        sessionId: string
      }
      const tools = yield* listPageTools(conn, 10000, attached.sessionId)
      const handle = `s_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
      yield* store.save({
        handle,
        url,
        origin: parsed.origin,
        httpEndpoint: launched.httpEndpoint,
        targetId: created.targetId,
        ownBrowser: true,
        pid: launched.pid,
        createdAt: Date.now(),
      })
      return { handle, url, toolCount: tools.length } satisfies Opened
    } finally {
      yield* conn.close
    }
  })
  // Failure owns cleanup: the browser dies with the failed open.
  return yield* run.pipe(Effect.tapError(() => launched.close))
})

export const closeSession = Effect.fn("sessions.closeSession")(function* (handle: string) {
  const store = yield* SessionStore
  const record = yield* store.load(handle)
  if (record.ownBrowser && (yield* isOurs(record.pid))) {
    try {
      process.kill(record.pid, "SIGKILL")
    } catch {
      // Dead already — removal below still happens.
    }
  }
  yield* store.remove(handle)
  return { closed: handle } as const
})

// Reattach: dial a recorded session's browser and attach its target.
// Every verb that touches a live page starts here.
export const reattach = Effect.fn("sessions.reattach")(function* (record: SessionRecord) {
  const wsUrl = yield* discoverWs(record.httpEndpoint, 5000)
  const conn = yield* connect(wsUrl)
  const attached = (yield* sendBounded(conn, "Target.attachToTarget", { targetId: record.targetId, flatten: true }, 10000)) as {
    sessionId: string
  }
  return { conn, sessionId: attached.sessionId }
})

export const listSessions = Effect.fn("sessions.listSessions")(function* () {
  const store = yield* SessionStore
  return yield* store.list()
})
