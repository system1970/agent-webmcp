import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ToolFailed } from "./definition.ts"
import { allTools, findTool } from "./registry.ts"
import { search } from "./search.ts"
import { execute, shapeContent } from "./execute.ts"
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
  test("lists search and execute", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(["execute", "search"])
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

  test("unknown words match nothing", async () => {
    expect(names(await ok(search, { query: "zzzqqq" }))).toEqual([])
  })

  test("empty query fails", async () => {
    const failure = await err(search, { query: "   " })
    expect(failure).toBeInstanceOf(ToolFailed)
    expect((failure as ToolFailed).message).toMatch(/empty/)
  })
})

describe("shapeContent", () => {
  test("passes short content through", () => {
    expect(shapeContent("abc", 64000)).toBe("abc")
  })

  test("truncates long content with a marker", () => {
    const out = shapeContent("x".repeat(70000), 2000)
    expect(out).toMatch(/truncated at 2000 chars/)
    expect(out.length).toBeLessThan(2100)
  })

  test("clamps to ceiling", () => {
    const out = shapeContent("x".repeat(70000), 999999)
    expect(out).toMatch(/truncated at 64000 chars/)
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

  test("rejects sessions (unwired)", async () => {
    const failure = await err(execute, {
      calls: [{ tool: "search", args: { query: "x" } }],
      sessionId: "abc"
    })
    expect((failure as ToolFailed).message).toMatch(/unknown session/)
  })

  test("rejects malformed batches", async () => {
    expect(await err(execute, { calls: "nope" })).toBeInstanceOf(ToolFailed)
  })
})
