import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { Effect } from "effect"
import { ToolFailed } from "./definition.ts"
import { allTools, findTool } from "./registry.ts"
import { search, clampLimit, signature } from "./search.ts"
import { execute, sanitizeMaxChars } from "./execute.ts"
import { describe as describeTool } from "./describe.ts"
import { saveSession } from "../sessions/store.ts"
import { RUN_TIMEOUT_MAX_MS, INVOKE_TIMEOUT_MS } from "../budgets.ts"
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

// Hermetic sessions dir: the production dir is shared, so point it at
// a fresh kernel-uniquified tmpdir (no wall-clock, no collision),
// restored + removed in finally.
const withEmptySessionsDir = async <A>(fn: () => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(`${tmpdir()}/agent-webmcp-unknown-`)
  const prev = Bun.env.AGENT_SESSIONS_DIR
  Bun.env.AGENT_SESSIONS_DIR = dir
  try {
    return await fn()
  } finally {
    if (prev === undefined) {
      delete Bun.env.AGENT_SESSIONS_DIR
    } else {
      Bun.env.AGENT_SESSIONS_DIR = prev
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

const deadRecord = (handle: string) => ({
  handle,
  browserHttp: "http://127.0.0.1:9/",
  targetId: "deadbeef",
  url: "http://dead.test/",
  ownBrowser: false,
  createdAt: "2026-01-01T00:00:00.000Z"
})

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

  test("execute tool record carries code/session inputs", async () => {
    const record = JSON.parse(await ok(describeTool, { tool: "execute" })) as {
      name: string
      inputSchema: { properties: { handle: unknown; sessions: unknown; code: unknown; timeoutMs: unknown } }
    }
    expect(record.name).toBe("execute")
    expect(record.inputSchema.properties.code).toBeDefined()
    expect(record.inputSchema.properties.timeoutMs).toBeDefined()
    expect(record.inputSchema.properties.sessions).toBeDefined()
  })

  test("execute rejects bad timeout without a browser", async () => {
    const failure = await err(execute, { handle: "s_deadbeef01", code: "return 1", timeoutMs: 999999999 })
    expect((failure as ToolFailed).message).toMatch(new RegExp(`1-${RUN_TIMEOUT_MAX_MS}`))
  })

  test("execute rejects empty code without a browser", async () => {
    const failure = await err(execute, { handle: "s_deadbeef01", code: "   " })
    expect((failure as ToolFailed).message).toMatch(/empty/)
  })

  test("execute rejects non-positive maxChars without a browser", async () => {
    const failure = await err(execute, { handle: "s_deadbeef01", code: "return 1", maxChars: -5 })
    expect((failure as ToolFailed).message).toMatch(/positive integer/)
  })

  test("execute rejects oversized code without a browser", async () => {
    const failure = await err(execute, { handle: "s_deadbeef01", code: `return 1; /*${"x".repeat(70000)}*/` })
    expect((failure as ToolFailed).message).toMatch(/chunk the block/)
  })

  test("execute rejects handle+sessions together", async () => {
    const failure = await err(execute, { handle: "s_deadbeef01", sessions: { a: "s_deadbeef02" }, code: "return 1" })
    expect((failure as ToolFailed).message).toMatch(/exactly one of handle\/sessions/)
  })

  test("execute rejects missing session wiring", async () => {
    const failure = await err(execute, { code: "return 1" })
    expect((failure as ToolFailed).message).toMatch(/exactly one of handle\/sessions/)
  })

  test("execute rejects empty sessions map", async () => {
    const failure = await err(execute, { sessions: {}, code: "return 1" })
    expect((failure as ToolFailed).message).toMatch(/at least one alias/)
  })

  test("execute caps bound sessions without a browser", async () => {
    const sessions: Record<string, string> = {}
    for (let i = 0; i < 9; i++) sessions[`s${i}`] = "s_deadbeef01"
    const failure = await err(execute, { sessions, code: "return 1" })
    expect((failure as ToolFailed).message).toMatch(/at most 8 sessions/)
  })

  test("execute rejects duplicate handles across aliases", async () => {
    const failure = await err(execute, { sessions: { a: "s_deadbeef01", b: "s_deadbeef01" }, code: "return 1" })
    expect((failure as ToolFailed).message).toMatch(/bound twice/)
  })

  test("execute rejects prototype-chain aliases without a browser", async () => {
    for (const alias of ["__proto__", "constructor", "prototype", "9lives", "has space"]) {
      const failure = await err(execute, { sessions: { [alias]: "s_deadbeef01" }, code: "return 1" })
      expect((failure as ToolFailed).message).toMatch(/plain identifier/)
    }
  })

  test("sanitizeMaxChars falls back on non-finite, rejects non-positive", () => {
    expect(sanitizeMaxChars(undefined)).toBeUndefined()
    expect(sanitizeMaxChars(NaN)).toBeUndefined()
    expect(sanitizeMaxChars(Infinity)).toBeUndefined()
    expect(sanitizeMaxChars(5000)).toBe(5000)
    // Huge finite passes through — shapeResult clamps to CHAR_BUDGET.
    expect(sanitizeMaxChars(1e12)).toBe(1e12)
    // Non-positive finite throws RangeError (single validator: the
    // tool catches this pre-dial, the CLI mirrors it at the flag).
    expect(() => sanitizeMaxChars(-5)).toThrow(RangeError)
    expect(() => sanitizeMaxChars(0)).toThrow(RangeError)
  })

  test("execute timeout ceiling covers the per-call ceiling", async () => {
    // Distinct symbols, intended relation: a run must admit at least
    // one full per-call budget. Same value today, separate meaning —
    // locked so a retune can't silently invert them.
    expect(RUN_TIMEOUT_MAX_MS).toBeGreaterThanOrEqual(INVOKE_TIMEOUT_MS)
  })

  test("execute rejects malformed handles fast", async () => {
    const failure = await err(execute, { handle: "abc", code: "return 1" })
    expect((failure as ToolFailed).message).toMatch(/invalid session handle/)
  })

  test("execute rejects unknown handles as unknown sessions", async () => {
    await withEmptySessionsDir(async () => {
      const failure = await err(execute, { handle: "s_deadbeef01", code: "return 1" })
      expect((failure as ToolFailed).message).toMatch(/unknown session/)
    })
  })

  test("execute rejects unknown sessions map entries", async () => {
    await withEmptySessionsDir(async () => {
      const failure = await err(execute, { sessions: { a: "s_deadbeef01" }, code: "return 1" })
      expect((failure as ToolFailed).message).toMatch(/unknown session/)
    })
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
    expect(names(await ok(search, { query: "loops branches code" }))).toContain("execute")
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
    const failure = await err(search, { query: "x", handle: "abc" })
    expect((failure as ToolFailed).message).toMatch(/invalid session handle/)
  })

  test("unknown well-formed sessions fail as unknown", async () => {
    await withEmptySessionsDir(async () => {
      const failure = await err(search, { query: "x", handle: "s_deadbeef01" })
      expect((failure as ToolFailed).message).toMatch(/unknown session/)
    })
  })

  test("all sweeps best-effort: dead sessions land in skipped", async () => {
    await withEmptySessionsDir(async () => {
      await Effect.runPromise(saveSession(deadRecord("s_dead01")))
      const report = JSON.parse(await ok(search, { query: "tool", all: true })) as {
        tools: Array<{ name: string }>
        skipped: Array<{ session: string; reason: string }>
      }
      // Engine hits still rank (reconnaissance degrades, never fails);
      // the dead record is named, not silent.
      expect(report.tools.length).toBeGreaterThan(0)
      expect(report.skipped).toEqual([{ session: "s_dead01", reason: expect.anything() }])
    })
  })

  test("explicit dead handles fail loud (not skipped)", async () => {
    await withEmptySessionsDir(async () => {
      await Effect.runPromise(saveSession(deadRecord("s_dead01")))
      const failure = await err(search, { query: "tool", handles: ["s_dead01", "s_dead02"] })
      expect(failure).toBeInstanceOf(ToolFailed)
    })
  })

  test("empty query fails", async () => {
    const failure = await err(search, { query: "   " })
    expect(failure).toBeInstanceOf(ToolFailed)
    expect((failure as ToolFailed).message).toMatch(/empty/)
  })

  test("all with explicit handles refuses the ambiguity", async () => {
    const failure = await err(search, { query: "x", all: true, handle: "s_deadbeef01" })
    expect((failure as ToolFailed).message).toMatch(/either all or/)
    const failure2 = await err(search, { query: "x", all: true, handles: ["s_deadbeef01"] })
    expect((failure2 as ToolFailed).message).toMatch(/either all or/)
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
  // Code-only contract: every positive path needs a live session
  // (covered by eval:mcp + eval:xpage). Unit locks the shape that
  // fails before any CDP dial.
  test("execute requires code", async () => {
    const failure = await err(execute, { handle: "s_deadbeef01" })
    expect(failure).toBeInstanceOf(ToolFailed)
  })

  test("execute rejects non-record sessions", async () => {
    const failure = await err(execute, { sessions: ["nope"], code: "return 1" })
    expect(failure).toBeInstanceOf(ToolFailed)
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
