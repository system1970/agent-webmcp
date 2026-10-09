// Runner tests: composition semantics with stub calls (no browser).
// Budgets, diagnostics, spill, and concurrency, all offline.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CallFailed, runCode, type CallFn } from "./runner.ts"

const budgets = { timeoutMs: 5000, maxToolCalls: 25, maxChars: 8000, maxResultChars: 64000 }

const ok =
  (fn: (input: unknown) => unknown): CallFn =>
  (input: unknown) =>
    Effect.try({
      try: () => fn(input),
      catch: (err) => new CallFailed({ message: err instanceof Error ? err.message : String(err) }),
    })

describe("runner", () => {
  test("sequence + transform + return", async () => {
    const out = await Effect.runPromise(
      runCode({
        code: "const a = await tools.t.add({ n: 1 }); return { got: a + 1 };",
        calls: { "t.add": ok((input) => (input as { n: number }).n * 10) },
        budgets,
      })
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value).toEqual({ got: 11 })
      expect(out.toolCalls).toBe(1)
      expect(out.calls).toEqual(["t.add"])
    }
  })

  test("parallel calls join", async () => {
    const out = await Effect.runPromise(
      runCode({
        code: "const [a, b] = await Promise.all([tools.t.a({}), tools.t.b({})]); return [a, b];",
        calls: { "t.a": ok(() => "A"), "t.b": ok(() => "B") },
        budgets,
      })
    )
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.value).toEqual(["A", "B"])
  })

  test("tool refusal is a ToolFailure diagnostic, not a throw", async () => {
    const out = await Effect.runPromise(
      runCode({
        code: "return await tools.t.nope({});",
        calls: { "t.nope": () => Effect.fail(new CallFailed({ message: "page says no" })) },
        budgets,
      })
    )
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error.kind).toBe("ToolFailure")
      expect(out.error.message).toContain("page says no")
    }
  })

  test("maxToolCalls fails the run", async () => {
    const out = await Effect.runPromise(
      runCode({
        code: "while (true) { await tools.t.ping({}); }",
        calls: { "t.ping": ok(() => 1) },
        budgets: { ...budgets, maxToolCalls: 3 },
      })
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.kind).toBe("ToolCallLimitExceeded")
    if (!out.ok) expect(out.toolCalls).toBe(3)
  })

  test("timeout is a diagnostic with worker cleanup", async () => {
    const out = await Effect.runPromise(
      runCode({
        code: "return await tools.t.hang({});",
        calls: { "t.hang": () => Effect.never },
        budgets: { ...budgets, timeoutMs: 300 },
      })
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.kind).toBe("TimeoutExceeded")
  })

  test("syntax errors are ParseError", async () => {
    const out = await Effect.runPromise(
      runCode({ code: "return await (({});", calls: {}, budgets })
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.kind).toBe("ParseError")
  })

  test("undefined normalizes to null; spill flags truncation", async () => {
    const empty = await Effect.runPromise(runCode({ code: "return;", calls: {}, budgets }))
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.value).toBeNull()
    const big = await Effect.runPromise(
      runCode({ code: "return await tools.t.big({});", calls: { "t.big": ok(() => "x".repeat(500)) }, budgets: { ...budgets, maxResultChars: 100 } })
    )
    expect(big.ok).toBe(true)
    if (big.ok) {
      expect(big.spilled).toBe(true)
      expect(String(big.value).length).toBeLessThan(200)
    }
  })

  test("unknown tool path fails the call, not the bridge", async () => {
    const out = await Effect.runPromise(
      runCode({ code: "return await tools.nope.missing({});", calls: {}, budgets })
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error.message).toContain("unknown tool path")
  })
})
