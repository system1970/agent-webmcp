import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CliFailure } from "../failure.ts"
import type { TransportFailed } from "../transport/errors.ts"
import { normalizeOutput, registerSessionTool } from "./verbs.ts"

// L6 regression lock: consumption shape, not wire shape. Every case is a
// real envelope the transport has delivered (showcase) or a scalar the
// fixtures deliver — no invented wire formats.
describe("normalizeOutput", () => {
  test("structuredContent wins over content text", () => {
    const out = normalizeOutput({
      content: [{ type: "text", text: "{\"wrong\":true}" }],
      structuredContent: { count: 1, products: [{ id: "p" }] }
    })
    expect(out).toEqual({ count: 1, products: [{ id: "p" }] })
  })
  test("JSON text part parses", () => {
    expect(normalizeOutput({ content: [{ type: "text", text: "[{\"id\":\"F1\"}]" }] }))
      .toEqual([{ id: "F1" }])
  })
  test("non-JSON text part stays raw", () => {
    expect(normalizeOutput({ content: [{ type: "text", text: "rooms from H" }] }))
      .toBe("rooms from H")
  })
  test("scalars pass through untouched", () => {
    expect(normalizeOutput("[{\"id\":\"F1\"}]")).toBe("[{\"id\":\"F1\"}]")
    expect(normalizeOutput(42)).toBe(42)
    expect(normalizeOutput(undefined)).toBeUndefined()
  })
  test("malformed envelopes pass through, never throw", () => {
    expect(normalizeOutput({ content: [] })).toEqual({ content: [] })
    expect(normalizeOutput({ content: [{ nope: 1 }] })).toEqual({ content: [{ nope: 1 }] })
    expect(normalizeOutput(null)).toBeNull()
  })
})

// Register validation fails pre-dial (no browser needed). Live page runs
// are eval-cloudflare's job.
describe("registerSessionTool", () => {
  const runErr = (effect: Effect.Effect<unknown, CliFailure | TransportFailed>): Promise<CliFailure | TransportFailed> =>
    Effect.runPromise(Effect.flip(effect))
  const def = {
    name: "getStock",
    description: "Look up stock.",
    inputSchema: { type: "object" },
    code: "async (args) => ({})"
  }
  test("bad names fail loud", async () => {
    // Spec-shaped: pattern + length only. Prototype-chain spellings are
    // harmless here (string Map keys, never property access — unlike
    // session aliases, which stay guarded).
    for (const name of ["", "has space", "a".repeat(129)]) {
      const failure = await runErr(registerSessionTool("s_deadbeef01", { ...def, name }))
      expect(failure.message).toMatch(/bad tool name/)
    }
  })
  test("empty description and code fail loud", async () => {
    const d = await runErr(registerSessionTool("s_deadbeef01", { ...def, description: "  " }))
    expect(d.message).toMatch(/description is empty/)
    const c = await runErr(registerSessionTool("s_deadbeef01", { ...def, code: "  " }))
    expect(c.message).toMatch(/code is empty/)
  })
  test("non-object schema fails loud", async () => {
    const failure = await runErr(registerSessionTool("s_deadbeef01", {
      ...def, inputSchema: [] as unknown as Record<string, unknown>
    }))
    expect(failure.message).toMatch(/inputSchema must be a JSON Schema object/)
  })
})
