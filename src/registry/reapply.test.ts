// Reapply tests: presence-check matrix on a fake native domain.
// Fake serves WebMCP.enable→burst + Runtime.evaluate for snippets.
// Burst catalog is stateful per connection: native "keep" always live;
// "fresh" appears after its snippet runs (registration works); "ghost"
// snippets succeed but never appear (quarantine: absent).
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connect, type CdpConnection } from "../transport/client.ts"
import { saveTool } from "./registry.ts"
import { reapplyOrigin } from "./reapply.ts"

const TOOLS = [
  { name: "keep", description: "native", inputSchema: { type: "object", properties: {} }, frameId: "f1" },
]

const serveFake = () => {
  let wsUrl = ""
  const registered = new Set<string>()
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
        const msg = JSON.parse(String(raw)) as { id: number; method: string; params?: Record<string, unknown> }
        if (msg.method === "WebMCP.enable") {
          ws.send(JSON.stringify({ id: msg.id, result: {} }))
          const tools = [...TOOLS]
          for (const name of registered) {
            if (name !== "ghost") {
              tools.push({ name, description: "re-applied", inputSchema: { type: "object", properties: {} }, frameId: "f1" })
            }
          }
          ws.send(JSON.stringify({ method: "WebMCP.toolsAdded", params: { tools } }))
        } else if (msg.method === "Runtime.evaluate") {
          const expr = String((msg.params as { expression?: unknown } | undefined)?.expression ?? "")
          const m = /"registered":\s*"([^"]+)"|registered:\s*def\.name|def\.name/.exec(expr)
          void m
          const nameMatch = /"name":\s*"([^"]+)"/.exec(expr)
          const name = nameMatch?.[1] ?? "?"
          if (expr.includes("registerTool")) {
            registered.add(name)
            ws.send(JSON.stringify({ id: msg.id, result: { result: { type: "string", value: JSON.stringify({ registered: name }) } } }))
          } else {
            ws.send(JSON.stringify({ id: msg.id, result: { result: { type: "string", value: '"ok"' } } }))
          }
        } else {
          ws.send(JSON.stringify({ id: msg.id, result: {} }))
        }
      },
    },
  })
  wsUrl = `ws://127.0.0.1:${server.port}/cdp`
  return { wsUrl, stop: () => server.stop(true) }
}

const specFor = (name: string) => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object", properties: {} },
  version: 1 as const,
  createdAt: 0,
})

describe("reapply", () => {
  test("fresh registers, keep skips, ghost quarantines, missing root is empty", async () => {
    const root = mkdtempSync(join(tmpdir(), "reapply-test-"))
    const fake = serveFake()
    try {
      for (const name of ["fresh", "keep", "ghost"]) {
        await Effect.runPromise(saveTool(root, "https://x.test", name, specFor(name), "(async () => 1)"))
      }
      const conn: CdpConnection = await Effect.runPromise(connect(fake.wsUrl))
      const out = await Effect.runPromise(
        reapplyOrigin({ conn, sessionId: "s1", origin: "https://x.test", root, timeoutMs: 3000 })
      )
      expect(out.reapplied).toEqual(["fresh"])
      const byName = new Map(out.skipped.map((s) => [s.name, s.reason]))
      expect(byName.get("keep")).toMatch(/already live/)
      expect(byName.get("ghost")).toMatch(/absent from catalog/)
      await Effect.runPromise(conn.close)
      // lastVerified stamped for the success only
      const { loadTool } = await import("./registry.ts")
      const fresh = await Effect.runPromise(loadTool(root, "https://x.test", "fresh"))
      expect(typeof fresh.spec.lastVerified).toBe("number")
      const ghost = await Effect.runPromise(loadTool(root, "https://x.test", "ghost"))
      expect(ghost.spec.lastVerified).toBeUndefined()
    } finally {
      fake.stop()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
