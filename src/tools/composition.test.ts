import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ToolFailed } from "./definition.ts"
import { allTools, findTool } from "./registry.ts"
import { search, clampLimit, signature } from "./search.ts"
import { execute } from "./execute.ts"
import { describe as describeTool } from "./describe.ts"
import { shapeResult } from "../spill.ts"
import type { WebmcpTool } from "./definition.ts"

const ok = (tool: WebmcpTool, args: unknown): Promise<string> =>
  Effect.runPromise(tool.execute(args)).then((r) => r.content)

const err = (tool: WebmcpTool, args: unknown): Promise<unknown> =>
  Effect.runPromise(tool.execute(args)).then(
    () => "unexpected success",
    (e: unknown) => e
  )

const names = (content: string): Array<string> =>
  (JSON.parse(content) as { tools: Array<{ name: string }> }).tools.map((t) => t.name)

describe("registry", () => {
  test("lists all seven tools", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual([
      "close",
      "describe",
      "execute",
      "invoke",
      "list",
      "open",
      "search"
    ].sort())
  })

  test("findTool misses cleanly", () => {
    expect(findTool("nope")).toBeUndefined()
  })
})

describe("search", () => {
  test("ranks the named tool first", async () => {
    expect(names(await ok(search, { query: "find tools" }))[0]).toBe("search")
  })

  test("finds execute by its behavior words", async () => {
    expect(names(await ok(search, { query: "multiple calls parallel" }))).toContain("execute")
  })

  test("respects limit", async () => {
    expect(names(await ok(search, { query: "tool", limit: 1 }))).toHaveLength(1)
  })

  test("engine results carry session:null", async () => {
    const tools = (JSON.parse(await ok(search, { query: "find tools" })) as {
      tools: Array<{ name: string; session: string | null }>
    }).tools
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.every((t) => t.session === null)).toBe(true)
  })

  test("unknown words match nothing", async () => {
    expect(names(await ok(search, { query: "zzzqqq" }))).toEqual([])
  })

  test("rejects malformed session handles fast", async () => {
    const failure = await err(execute, {
      calls: [{ tool: "search", args: { query: "x" } }],
      sessionId: "abc"
    })
    expect((failure as ToolFailed).message).toMatch(/invalid session handle/)
  })

  test("unknown well-formed sessions fail as unknown", async () => {
    const failure = await err(execute, {
      calls: [{ tool: "search", args: { query: "x" } }],
      sessionId: "s_deadbeef01"
    })
    expect((failure as ToolFailed).message).toMatch(/unknown session/)
  })

  test("empty query fails", async () => {
    const failure = await err(search, { query: "   " })
    expect(failure).toBeInstanceOf(ToolFailed)
    expect((failure as ToolFailed).message).toMatch(/empty/)
  })

  test("clampLimit defaults, clamps, and floors", () => {
    expect(clampLimit(undefined)).toBe(8)
    expect(clampLimit(NaN)).toBe(8)
    expect(clampLimit(Infinity)).toBe(8)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(-5)).toBe(1)
    expect(clampLimit(2.9)).toBe(2)
    expect(clampLimit(9999)).toBe(50)
  })

  test("non-positive limit still returns one result", async () => {
    expect(names(await ok(search, { query: "tool", limit: 0 }))).toHaveLength(1)
  })
})

describe("signature", () => {
  test("names required args with types", () => {
    expect(signature("searchFlights", {
      type: "object",
      properties: { origin: { type: "string" }, destination: { type: "string" } },
      required: ["origin", "destination"]
    })).toBe("searchFlights(origin: string, destination: string)")
  })

  test("marks optionals and truncates past six", () => {
    const props: Record<string, { type: string }> = {}
    for (let i = 0; i < 8; i++) props[`p${i}`] = { type: "number" }
    expect(signature("many", { type: "object", properties: props, required: ["p0"] }))
      .toBe("many(p0: number, p1: number?, p2: number?, p3: number?, p4: number?, p5: number?, …)")
  })

  test("degrades on hostile shapes", () => {
    expect(signature("x", undefined)).toBe("x(?)")
    expect(signature("x", null)).toBe("x(?)")
    expect(signature("x", { properties: null })).toBe("x()")
    expect(signature("x", [])).toBe("x()")
  })

  test("caps hostile key and signature length", () => {
    const props: Record<string, { type: string }> = {}
    for (let i = 0; i < 40; i++) props[`p${i}-` + "k".repeat(100)] = { type: "string" }
    const out = signature("many", { type: "object", properties: props, required: [] })
    expect(out.length).toBeLessThanOrEqual(256)
    expect(out).toMatch(/…\)$/)
  })
})

describe("shapeResult", () => {
  const budget = { min: 1000, max: 64000, fallback: 8000 }
  const dir = "/tmp/opencode/agent-webmcp-spill-test"

  test("passes short content through with no spill", async () => {
    process.env.AGENT_SPILL_DIR = dir
    const out = await Effect.runPromise(shapeResult("abc", 64000, budget))
    expect(out).toEqual({ text: "abc", spilled: null })
  })

  test("spills long content with a marker and byte-identical body", async () => {
    process.env.AGENT_SPILL_DIR = dir
    const body = "x".repeat(70000) + "-tail"
    const out = await Effect.runPromise(shapeResult(body, 2000, budget))
    expect(out.text).toMatch(/truncated at 2000 chars; full body: /)
    expect(out.spilled).not.toBeNull()
    expect(await Bun.file(out.spilled as string).text()).toBe(body)
  })

  test("clamps to ceiling", async () => {
    process.env.AGENT_SPILL_DIR = dir
    const out = await Effect.runPromise(shapeResult("x".repeat(70000), 999999, budget))
    expect(out.text).toMatch(/truncated at 64000 chars/)
  })

  test("never chmods a pre-existing dir (no retarget to shared parents)", async () => {
    process.env.AGENT_SPILL_DIR = dir
    const { mkdirSync, chmodSync, statSync } = await import("node:fs")
    mkdirSync(dir, { recursive: true })
    chmodSync(dir, 0o755)
    const out = await Effect.runPromise(shapeResult("y".repeat(5000), 1000, budget))
    expect(out.spilled).not.toBeNull()
    expect((statSync(dir).mode & 0o777).toString(8)).toBe("755")
    expect((statSync(out.spilled as string).mode & 0o777).toString(8)).toBe("600")
  })

  test("fresh dir gets 0700", async () => {
    const fresh = `${dir}-fresh`
    const { rmSync, statSync } = await import("node:fs")
    rmSync(fresh, { recursive: true, force: true })
    process.env.AGENT_SPILL_DIR = fresh
    const out = await Effect.runPromise(shapeResult("z".repeat(5000), 1000, budget))
    expect(out.spilled).not.toBeNull()
    expect((statSync(fresh).mode & 0o777).toString(8)).toBe("700")
    rmSync(fresh, { recursive: true, force: true })
    process.env.AGENT_SPILL_DIR = dir
  })
})

describe("execute", () => {
  test("batch keeps per-item ok flags", async () => {
    const content = await ok(execute, {
      calls: [
        { tool: "search", args: { query: "find" } },
        { tool: "bogus", args: {} }
      ]
    })
    const report = JSON.parse(content) as {
      sessionId: null
      results: Array<{ tool: string; ok: boolean; result: string }>
    }
    expect(report.sessionId).toBeNull()
    expect(report.results.map((r) => [r.tool, r.ok])).toEqual([
      ["search", true],
      ["bogus", false]
    ])
    expect(report.results[1].result).toMatch(/unknown tool/)
  })

  test("clamps tiny maxChars to the floor instead of truncating", async () => {
    const tiny = await ok(execute, {
      calls: [{ tool: "search", args: { query: "find" } }],
      maxChars: 50
    })
    const full = await ok(execute, {
      calls: [{ tool: "search", args: { query: "find" } }],
      maxChars: 64000
    })
    // Floor is 1000; registry results are shorter, so both return whole.
    // The slice+marker path only triggers on page-tool-sized results.
    expect(JSON.parse(tiny)).toEqual(JSON.parse(full))
    expect(tiny).not.toMatch(/truncated/)
  })

  test("rejects oversized batches loudly", async () => {
    const calls = Array.from({ length: 6 }, () => ({ tool: "search", args: { query: "x" } }))
    const failure = await err(execute, { calls })
    expect(failure).toBeInstanceOf(ToolFailed)
    expect((failure as ToolFailed).message).toMatch(/at most 5/)
  })

  test("rejects empty batches", async () => {
    const failure = await err(execute, { calls: [] })
    expect((failure as ToolFailed).message).toMatch(/no calls/)
  })

  test("rejects malformed batches", async () => {
    expect(await err(execute, { calls: "nope" })).toBeInstanceOf(ToolFailed)
  })
})

describe("describe", () => {
  test("engine tool returns its record", async () => {
    const record = JSON.parse(await ok(describeTool, { tool: "search" })) as {
      name: string
      inputSchema: { properties: { query: unknown } }
      session: null
    }
    expect(record.name).toBe("search")
    expect(record.inputSchema.properties.query).toBeDefined()
    expect(record.session).toBeNull()
  })

  test("unknown engine tool fails with guidance", async () => {
    const failure = await err(describeTool, { tool: "nope" })
    expect((failure as ToolFailed).message).toMatch(/Pass handle to describe a page tool/)
  })

  test("bad session handle fails as invalid, not unknown", async () => {
    const failure = await err(describeTool, { handle: "abc", tool: "x" })
    expect((failure as ToolFailed).message).toMatch(/invalid session handle/)
  })
})
