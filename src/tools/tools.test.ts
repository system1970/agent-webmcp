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
import { SessionStore } from "../sessions/store.ts"
import { Browser } from "../sessions/sessions.ts"
import { TransportFailed } from "../transport/errors.ts"

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
    expect(allTools.map((t) => t.name).sort()).toEqual(["close", "execute", "list", "open", "register", "search"])
    expect(findTool("open")?.description.length).toBeGreaterThan(0)
    expect(findTool("nope")).toBeUndefined()
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
        })
      }
      return yield* close.execute({ all: true }, {})
    })
    const out = await run(Effect.provide(program, layers))
    expect(JSON.parse(out.content)).toEqual({ closed: ["s_1", "s_2"], failed: [] })
  })
})
