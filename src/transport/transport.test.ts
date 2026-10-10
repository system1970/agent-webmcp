// Transport tests: a fake CDP server (Bun.serve) proves the client
// without a browser. Deterministic, offline, no fixtures.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { connect, invokePageTool, listPageTools, sendBounded } from "./client.ts"
import { launchChromium } from "./launch.ts"
import { TransportFailed } from "./errors.ts"

const TOOLS_JSON = JSON.stringify([
  { name: "add-todo", description: "Add a todo", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} } },
])

// Minimal NATIVE WebMCP domain: enable → toolsAdded burst; invokeTool →
// invocationId then toolResponded; cancelInvocation acked. Mode "silent"
// never answers (timeout proof); mode "garbage" bursts a malformed
// catalog (decode proof).
const serveFake = (mode: "tools" | "silent" | "garbage") => {
  let wsUrl = ""
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname === "/json/version") {
        return Response.json({ webSocketDebuggerUrl: wsUrl })
      }
      if (url.pathname === "/cdp" && server.upgrade(req)) return undefined
      return new Response("no", { status: 404 })
    },
    websocket: {
      open() {},
      message(ws, raw) {
        if (mode === "silent") return
        const msg = JSON.parse(String(raw)) as { id: number; method: string; params?: { toolName?: string } }
        if (msg.method === "WebMCP.enable") {
          ws.send(JSON.stringify({ id: msg.id, result: {} }))
          const tools =
            mode === "garbage"
              ? [{ name: 42 }]
              : [
                  { name: "add-todo", description: "Add a todo", inputSchema: { type: "object", properties: {} }, frameId: "f1", annotations: { readOnlyHint: true } },
                  { name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} }, frameId: "f1" },
                ]
          ws.send(JSON.stringify({ method: "WebMCP.toolsAdded", params: { tools } }))
        } else if (msg.method === "WebMCP.invokeTool") {
          ws.send(JSON.stringify({ id: msg.id, result: { invocationId: "inv-1" } }))
          const output = msg.params?.toolName === "boom" ? undefined : { content: [{ type: "text", text: "ok" }] }
          ws.send(
            JSON.stringify({
              method: "WebMCP.toolResponded",
              params:
                output === undefined
                  ? { invocationId: "inv-1", status: "Error", errorText: "page blew up" }
                  : { invocationId: "inv-1", status: "Completed", output },
            })
          )
        } else if (msg.method === "WebMCP.cancelInvocation") {
          ws.send(JSON.stringify({ id: msg.id, result: {} }))
        } else if (msg.method === "Target.attachToTarget") {
          ws.send(JSON.stringify({ id: msg.id, result: { sessionId: "sesh-test" } }))
        } else {
          ws.send(JSON.stringify({ id: msg.id, result: {} }))
        }
      },
    },
  })
  wsUrl = `ws://127.0.0.1:${server.port}/cdp`
  return { server, wsUrl, stop: () => server.stop(true) }
}

const run = <A>(effect: Effect.Effect<A, TransportFailed, never>): Promise<A> => Effect.runPromise(effect)

const fails = <A>(effect: Effect.Effect<A, TransportFailed, never>): Promise<TransportFailed> =>
  Effect.runPromise(Effect.flip(effect))

describe("transport", () => {
  test("listPageTools decodes + normalizes readOnlyHint", async () => {
    const fake = serveFake("tools")
    try {
      const conn = await run(connect(fake.wsUrl))
      const tools = await run(listPageTools(conn, 2000))
      expect(tools.map((t) => t.name)).toEqual(["add-todo", "ping"])
      expect(tools[0]?.annotations).toEqual({ readOnly: true })
      expect(tools[1]?.annotations).toEqual({})
      expect(tools[0]?.frameId).toBe("f1")
      await run(conn.close)
    } finally {
      fake.stop()
    }
  })

  test("invokePageTool returns output; page Error is data", async () => {
    const fake = serveFake("tools")
    try {
      const conn = await run(connect(fake.wsUrl))
      const ok = await run(invokePageTool(conn, "sesh-1", { frameId: "f1", toolName: "ping", args: {} }, 2000))
      expect(ok.status).toBe("Completed")
      const failed = await run(invokePageTool(conn, "sesh-1", { frameId: "f1", toolName: "boom", args: {} }, 2000))
      expect(failed.status).toBe("Error")
      expect(failed.errorText).toBe("page blew up")
      await run(conn.close)
    } finally {
      fake.stop()
    }
  })

  test("silent browser fails the call, not the fiber", async () => {
    const fake = serveFake("silent")
    try {
      const conn = await run(connect(fake.wsUrl))
      const err = await fails(sendBounded(conn, "Runtime.evaluate", {}, 200))
      expect(err.reason).toBe("timeout")
      await run(conn.close)
    } finally {
      fake.stop()
    }
  })

  test("garbage value is a decode failure", async () => {
    const fake = serveFake("garbage")
    try {
      const conn = await run(connect(fake.wsUrl))
      const err = await fails(listPageTools(conn, 2000))
      expect(err.reason).toBe("decode")
      await run(conn.close)
    } finally {
      fake.stop()
    }
  })

  test("unreachable port is a connect failure with a fix", async () => {
    const err = await fails(connect("ws://127.0.0.1:1/cdp"))
    expect(err.reason).toBe("connect")
    expect(err.fix.length).toBeGreaterThan(0)
  })

  test("launch refuses bad ports without spawning", async () => {
    const err = await fails(launchChromium(80))
    expect(err.reason).toBe("no-browser")
  })

  test("buildArgs: headless default, headed branch, viewport always", async () => {
    const { buildArgs } = await import("./launch.ts")
    const headless = buildArgs({ port: 9333, userDataDir: "/tmp/x", headed: false })
    expect(headless).toContain("--headless")
    expect(headless).toContain("--window-size=1400,950")
    expect(headless).toContain("--force-device-scale-factor=1")
    expect(headless).not.toContain("--ozone-platform-hint=auto")
    const headed = buildArgs({ port: 9333, userDataDir: "/tmp/x", headed: true })
    expect(headed).not.toContain("--headless")
    expect(headed).toContain("--ozone-platform-hint=auto")
    expect(headed).toContain("--window-size=1400,950")
    expect(headed).toContain("--enable-features=WebMCPTesting,DevToolsWebMCPSupport")
  })
})
