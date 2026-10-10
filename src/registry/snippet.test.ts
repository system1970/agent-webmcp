// Snippet tests: fixed shapes, pure parsers. No browser.
import { describe, expect, test } from "bun:test"
import { parseRegisterReply, parseUnregisterReply, registerSnippet, unregisterSnippet } from "./snippet.ts"

describe("snippets", () => {
  test("register snippet carries def+body and AbortSignal lifecycle", () => {
    const s = registerSnippet("ping", `{"name":"ping"}`, "(async () => 1)")
    expect(s).toContain("registerTool(def, { signal: controller.signal })")
    expect(s).toContain("__agentWebmcp")
    expect(s).toContain("(async () => 1)")
    expect(s).toContain(`{"name":"ping"}`)
  })

  test("unregister snippet aborts the stored controller", () => {
    const s = unregisterSnippet("ping")
    expect(s).toContain("abort()")
    expect(s).toContain("ping")
  })

  test("parseRegisterReply matrix", () => {
    expect(parseRegisterReply(JSON.stringify({ registered: "ping" }), "ping")).toBeNull()
    expect(parseRegisterReply(JSON.stringify({ error: "dup" }), "ping")).toMatch(/page refused: dup/)
    expect(parseRegisterReply(JSON.stringify({ registered: "other" }), "ping")).toMatch(/page refused/)
    expect(parseRegisterReply("not json", "ping")).toMatch(/non-JSON/)
    expect(parseRegisterReply(42, "ping")).toMatch(/non-JSON/)
  })

  test("parseUnregisterReply matrix", () => {
    expect(parseUnregisterReply("ok")).toBeNull()
    expect(parseUnregisterReply(JSON.stringify({ error: "gone" }))).toMatch(/page refused: gone/)
    expect(parseUnregisterReply(42)).toMatch(/non-JSON/)
  })
})
