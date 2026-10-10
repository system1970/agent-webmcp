// Tools tests: contracts that ship to strangers (schemas, ranking,
// spec validation, registry shape). Browser-touching verbs prove
// themselves in the hand smoke, not here.
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { decodeArgs, toInputSchema, ToolFailed } from "./definition.ts"
import { allTools, findTool } from "./registry.ts"
import { rankTools } from "./search.ts"
import { checkSpec } from "./register.ts"
import { close } from "./close.ts"
import { list } from "./list.ts"
import { SessionStore } from "../sessions/store.ts"
import { Browser } from "../sessions/sessions.ts"
import { TransportFailed } from "../transport/errors.ts"
import { unregister } from "./unregister.ts"

const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(effect)
const fails = <A, E>(effect: Effect.Effect<A, E, never>): Promise<E> => Effect.runPromise(Effect.flip(effect))

describe("tools", () => {
  test("toInputSchema is always top-level object (poisoning guard)", () => {
    const normal = toInputSchema(Schema.Struct({ url: Schema.String }))
    expect(normal["type"]).toBe("object")
    const empty = toInputSchema(Schema.Struct({}))
    expect(empty["type"]).toBe("object")
  })

  test("ToolFailed message is co-located", () => {
    const err = new ToolFailed({ tool: "open", detail: "gone" })
    expect(err.message).toBe("open: gone")
    expect(err._tag).toBe("ToolFailed")
  })

  test("decodeArgs names the tool on failure", async () => {
    const S = Schema.Struct({ url: Schema.String })
    const err = await fails(decodeArgs(S, "open")({ url: 42 }))
    expect(err.tool).toBe("open")
    const ok = await run(decodeArgs(S, "open")({ url: "https://x.test" }))
    expect(ok.url).toBe("https://x.test")
  })

  test("rankTools: exact name wins, plurals match, ties alphabetical", () => {
    const catalogs = [
      {
        session: "s_1",
        tools: [
          { name: "zzz", description: "manages issues", inputSchema: {}, annotations: {}, frameId: "f1" },
          { name: "issues", description: "unrelated", inputSchema: {}, annotations: {}, frameId: "f1" },
          { name: "aaa", description: "manages issues", inputSchema: {}, annotations: {}, frameId: "f1" },
        ],
      },
    ]
    const hits = rankTools("issues", catalogs)
    expect(hits.map((h) => h.tool.name)).toEqual(["issues", "aaa", "zzz"])
  })

  test("checkSpec rejects loudly, accepts clean specs", () => {
    expect(checkSpec({ name: "bad name!", description: "d", inputSchema: {} }, "async () => 1")).toMatch(/bad tool name/)
    expect(checkSpec({ name: "ok", description: "  ", inputSchema: {} }, "async () => 1")).toMatch(/empty/)
    expect(checkSpec({ name: "ok", description: "d", inputSchema: [] }, "async () => 1")).toMatch(/object/)
    expect(checkSpec({ name: "ok", description: "d", inputSchema: {} }, "   ")).toMatch(/empty/)
    expect(checkSpec({ name: "ok", description: "d", inputSchema: {} }, "async () => 1")).toBeNull()
  })

  test("registry: five verbs, unique names, findable", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(["close", "execute", "list", "open", "register", "search", "unregister"])
    expect(findTool("open")?.description.length).toBeGreaterThan(0)
    expect(findTool("nope")).toBeUndefined()
  })

  test("unregister refuses non-authored names pre-dial (no browser needed)", async () => {
    const noBrowser = Layer.succeed(Browser, {
      launch: () => Effect.fail(new TransportFailed({ reason: "no-browser", operation: "launch", message: "unused", fix: "test." })),
    })
    const layers = Layer.merge(SessionStore.Memory(), noBrowser)
    const program = Effect.gen(function* () {
      const s = yield* SessionStore
      yield* s.save({
        handle: "s_u",
        url: "https://x.test",
        origin: "https://x.test",
        httpEndpoint: "http://127.0.0.1:9",
        targetId: "t",
        ownBrowser: false,
        pid: 0,
        createdAt: 0,
        authored: ["mine"],
        suspect: [],
      })
      return yield* unregister.execute({ handle: "s_u", name: "native" }, {})
    })
    const err = await fails(Effect.provide(program, layers))
    expect(err).toBeInstanceOf(ToolFailed)
    if (err instanceof ToolFailed) {
      expect(err.tool).toBe("unregister")
      expect(err.detail).toMatch(/not session-authored/)
    }
  })

  test("list marks authored-live tools (+staleSuspect)", async () => {
    const noBrowser = Layer.succeed(Browser, {
      launch: () => Effect.fail(new TransportFailed({ reason: "no-browser", operation: "launch", message: "unused", fix: "test." })),
    })
    let wsUrl = ""
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
                    { name: "mine", description: "authored", inputSchema: { type: "object", properties: {} }, frameId: "f1" },
                    { name: "theirs", description: "native", inputSchema: { type: "object", properties: {} }, frameId: "f1" },
                  ],
                },
              })
            )
          } else if (msg.method === "Target.attachToTarget") {
            ws.send(JSON.stringify({ id: msg.id, result: { sessionId: "sesh-list" } }))
          } else {
            ws.send(JSON.stringify({ id: msg.id, result: {} }))
          }
        },
      },
    })
    wsUrl = `ws://127.0.0.1:${server.port}/cdp`
    const http = `http://127.0.0.1:${server.port}`
    const layers = Layer.merge(SessionStore.Memory(), noBrowser)
    try {
      const program = Effect.gen(function* () {
        const s = yield* SessionStore
        yield* s.save({
          handle: "s_l",
          url: "https://x.test",
          origin: "https://x.test",
          httpEndpoint: http,
          targetId: "tgt",
          ownBrowser: false,
          pid: 0,
          createdAt: 0,
          authored: ["mine"],
          suspect: ["mine"],
        })
        return yield* list.execute({ handle: "s_l" }, {})
      })
      const out = await run(Effect.provide(program, layers))
      const rows = JSON.parse(out.content) as Array<Record<string, unknown>>
      const mine = rows.find((r) => r["name"] === "mine")
      const theirs = rows.find((r) => r["name"] === "theirs")
      expect(mine).toMatchObject({ authored: true, staleSuspect: true })
      expect(theirs).toEqual({ name: "theirs", description: "native" })
      const full = await run(
        Effect.provide(
          Effect.gen(function* () {
            return yield* list.execute({ handle: "s_l", tool: "mine" }, {})
          }),
          layers
        )
      )
      expect(JSON.parse(full.content)).toMatchObject({ name: "mine", authored: true })
    } finally {
      server.stop(true)
    }
  })

  test("close --all sweeps best-effort", async () => {
    const store = SessionStore.Memory()
    const browser = Layer.succeed(Browser, {
      launch: () => Effect.fail(new TransportFailed({ reason: "no-browser", operation: "launch", message: "no browser in unit test", fix: "test double." })),
    })
    const layers = Layer.merge(store, browser)
    const program = Effect.gen(function* () {
      const s = yield* SessionStore
      for (const h of ["s_1", "s_2"]) {
        yield* s.save({
          handle: h,
          url: "https://x.test",
          origin: "https://x.test",
          httpEndpoint: "http://127.0.0.1:9",
          targetId: "t",
          ownBrowser: false,
          pid: 0,
          createdAt: 0,
        authored: [],
        suspect: [],
        })
      }
      return yield* close.execute({ all: true }, {})
    })
    const out = await run(Effect.provide(program, layers))
    expect(JSON.parse(out.content)).toEqual({ closed: ["s_1", "s_2"], failed: [] })
  })
})
