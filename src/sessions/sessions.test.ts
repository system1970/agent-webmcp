// Sessions tests: store contract on both layers, open→close loop
// against a fake CDP server, kill guard proven both directions.
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Browser, closeSession, isOurs, listSessions, openSession, PROFILE_MARKER } from "./sessions.ts"
import { SessionStore } from "./store.ts"

const serveFake = () => {
  let wsUrl = ""
  let http = ""
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname === "/json/version") return Response.json({ webSocketDebuggerUrl: wsUrl })
      if (url.pathname === "/cdp" && server.upgrade(req)) return undefined
      return new Response("no", { status: 404 })
    },
    websocket: {
      open() {},
      message(ws, raw) {
        const msg = JSON.parse(String(raw)) as { id: number; method: string }
        if (msg.method === "WebMCP.enable") {
          ws.send(JSON.stringify({ id: msg.id, result: {} }))
          ws.send(
            JSON.stringify({
              method: "WebMCP.toolsAdded",
              params: {
                tools: [
                  { name: "add-todo", description: "Add a todo", inputSchema: { type: "object", properties: {} }, frameId: "f1" },
                  { name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} }, frameId: "f1" },
                ],
              },
            })
          )
        } else if (msg.method === "Target.createTarget") {
          ws.send(JSON.stringify({ id: msg.id, result: { targetId: "tgt-1" } }))
        } else if (msg.method === "Target.attachToTarget") {
          ws.send(JSON.stringify({ id: msg.id, result: { sessionId: "sesh-1" } }))
        } else {
          ws.send(JSON.stringify({ id: msg.id, result: {} }))
        }
      },
    },
  })
  wsUrl = `ws://127.0.0.1:${server.port}/cdp`
  http = `http://127.0.0.1:${server.port}`
  return { http, stop: () => server.stop(true) }
}

const roots: Array<string> = []
const tmpRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "sess-test-"))
  roots.push(dir)
  return dir
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

const withLayers = <A, E>(effect: Effect.Effect<A, E, SessionStore | Browser>, store: Layer.Layer<SessionStore>, browser: Layer.Layer<Browser>) =>
  Effect.runPromise(Effect.provide(effect, Layer.merge(store, browser)))

const fakeBrowser = (http: string): Layer.Layer<Browser> =>
  Layer.succeed(Browser, {
    launch: (port: number) => Effect.succeed({ httpEndpoint: http, pid: 0, port, close: Effect.void }),
  })

describe("sessions", () => {
  test("store round-trips on disk", async () => {
    const program = Effect.gen(function* () {
      const store = yield* SessionStore
      yield* store.save({
        handle: "s_abc",
        url: "https://x.test",
        origin: "https://x.test",
        httpEndpoint: "http://127.0.0.1:9333",
        targetId: "t1",
        ownBrowser: true,
        pid: 1,
        createdAt: 0,
        authored: [],
      })
      const loaded = yield* store.load("s_abc")
      const listed = yield* store.list()
      yield* store.appendLog("s_abc", "hello")
      yield* store.remove("s_abc")
      const missing = yield* Effect.flip(store.load("s_abc"))
      return { loaded, listed, missing }
    })
    const out = await Effect.runPromise(Effect.provide(program, SessionStore.Disk(tmpRoot())))
    expect(out.loaded.url).toBe("https://x.test")
    expect(out.listed.map((r) => r.handle)).toEqual(["s_abc"])
    expect(out.missing.reason).toBe("missing")
  })

  test("memory layer honors the same contract", async () => {
    const program = Effect.gen(function* () {
      const store = yield* SessionStore
      yield* store.save({
        handle: "s_m",
        url: "https://y.test",
        origin: "https://y.test",
        httpEndpoint: "http://127.0.0.1:9334",
        targetId: "t2",
        ownBrowser: false,
        pid: 0,
        createdAt: 0,
        authored: [],
      })
      return yield* store.load("s_m")
    })
    const out = await Effect.runPromise(Effect.provide(program, SessionStore.Memory()))
    expect(out.origin).toBe("https://y.test")
  })

  test("open→list→close loop, no browser", async () => {
    const fake = serveFake()
    try {
      const store = SessionStore.Memory()
      const browser = fakeBrowser(fake.http)
      const opened = await withLayers(openSession("https://example.test"), store, browser)
      expect(opened.handle.startsWith("s_")).toBe(true)
      expect(opened.toolCount).toBe(2)
      const listed = await withLayers(listSessions(), store, browser)
      expect(listed.map((r) => r.handle)).toEqual([opened.handle])
      const closed = await withLayers(closeSession(opened.handle), store, browser)
      expect(closed).toEqual({ closed: opened.handle })
      const empty = await withLayers(listSessions(), store, browser)
      expect(empty).toEqual([])
    } finally {
      fake.stop()
    }
  })

  test("bad url fails before any launch", async () => {
    const store = SessionStore.Memory()
    const browser = fakeBrowser("http://127.0.0.1:1")
    const err = await Effect.runPromise(Effect.flip(Effect.provide(openSession("not-a-url"), Layer.merge(store, browser))))
    expect(err.reason).toBe("bad-url")
  })

  test("kill guard: ours dies, foreign lives", async () => {
    expect(await Effect.runPromise(isOurs(1))).toBe(false)
    const proc = Bun.spawn(["sh", "-c", `echo ${PROFILE_MARKER}-probe; sleep 60`], { stdout: "ignore", stderr: "ignore" })
    try {
      expect(await Effect.runPromise(isOurs(proc.pid))).toBe(true)
    } finally {
      proc.kill()
    }
  })
})
