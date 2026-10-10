// Sessions: open/close/list over disk handles. Browsers are owned per
// session (one browser, one page, one dir) — sharing comes later, if a
// unit ever needs it. Crash-safe: only the record persists; a dead
// browser is a transport failure on next verb, never a corrupt store.
import { Context, Effect, Layer } from "effect"
import { tmpdir } from "node:os"
import { connect, discoverWs, evaluateJson, listPageTools, sendBounded } from "../transport/client.ts"
import type { TransportFailed } from "../transport/errors.ts"
import { launchChromium, type Launched } from "../transport/launch.ts"
import { SessionStore, type SessionRecord } from "./store.ts"
import { StoreFailed } from "./errors.ts"
import { reapplyOrigin } from "../registry/reapply.ts"
import { REGISTRY_ENV, resolveRoot } from "../registry/registry.ts"
import { existsSync } from "node:fs"
import { unregisterSnippet } from "../registry/snippet.ts"

export const SESSION_ROOT = `${tmpdir()}/agent-webmcp-sessions`

// Browser seam: launch over owned Chromium. Exists so tests can
// substitute a fake (second implementation); production is launch.ts.
export interface BrowserApi {
  readonly launch: (port: number, options?: { headed?: boolean }) => Effect.Effect<Launched, TransportFailed>
}

export class Browser extends Context.Service<Browser, BrowserApi>()("Browser", {}) {
  static readonly Live: Layer.Layer<Browser> = Layer.succeed(Browser, {
    launch: (port: number, options?: { headed?: boolean }) => launchChromium(port, options ?? {}),
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
  readonly headed: boolean
  readonly reapplied: ReadonlyArray<string>
  readonly skipped: ReadonlyArray<{ readonly name: string; readonly reason: string }>
}

// Registry root for READS (re-apply): project-walk then global. Writes
// resolve separately (register demands project-or-env).
const readRoot = (): string | undefined =>
  resolveRoot(process.cwd(), process.env[REGISTRY_ENV], (d) => existsSync(`${d}/.agent-webmcp`))

export const openSession = Effect.fn("sessions.openSession")(function* (url: string, options: { headed?: boolean } = {}) {
  const store = yield* SessionStore
  const browser = yield* Browser
  const parsed = yield* Effect.try({
    try: () => new URL(url),
    catch: () => new StoreFailed({ reason: "bad-url", message: `not a URL: ${url.slice(0, 120)}`, fix: "pass an absolute http(s) URL." }),
  })
  const port = yield* findFreePort()
  const launched = yield* browser.launch(port, options.headed === true ? { headed: true } : {})
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
      const reapplied = yield* reapplyOrigin({ conn, sessionId: attached.sessionId, origin: parsed.origin, root: readRoot(), timeoutMs: 10000 })
      yield* store.save({
        handle,
        url,
        origin: parsed.origin,
        httpEndpoint: launched.httpEndpoint,
        targetId: created.targetId,
        ownBrowser: true,
        pid: launched.pid,
        createdAt: Date.now(),
        authored: [...reapplied.reapplied],
        suspect: [],
      })
      // toolCount includes re-applied names (each presence-verified, no
      // extra dial — the burst ran before they registered).
      return { handle, url, toolCount: tools.length + reapplied.reapplied.length, headed: options.headed === true, reapplied: reapplied.reapplied, skipped: reapplied.skipped } satisfies Opened
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
  // Borrowed tabs keep living: best-effort unregister of what we
  // authored (polite cleanup, failures ignored). Owned browsers die —
  // nothing lingers, no cleanup needed.
  if (!record.ownBrowser && record.authored.length > 0) {
    yield* Effect.gen(function* () {
      const { conn, sessionId } = yield* reattach(record)
      try {
        for (const name of record.authored) {
          yield* evaluateJson(conn, unregisterSnippet(name), 5000, sessionId).pipe(Effect.ignore)
        }
      } finally {
        yield* conn.close
      }
    }).pipe(Effect.ignore)
  }
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
