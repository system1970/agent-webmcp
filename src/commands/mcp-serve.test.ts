import type { Subprocess } from "bun"
import { describe, expect, test } from "bun:test"

// Serve self-reap lock: a stdio server whose client goes away must
// exit instead of idling (Bun busy-spins EOF-stdin loops — orphaned
// servers burned cores). Spawns our own binary over pipes: no network,
// no browser, ~1s. If this flakes, suspect Bun stdin semantics first.
const serve = (stdinMode: "pipe" | "eof"): Subprocess => {
  if (stdinMode === "eof") {
    return Bun.spawn(["bun", `${import.meta.dir}/../main.ts`, "mcp", "serve"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe"
    })
  }
  return Bun.spawn(["bun", `${import.meta.dir}/../main.ts`, "mcp", "serve"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  })
}

describe("mcp serve self-reap", () => {
  test("exits promptly when stdin is already EOF", async () => {
    const proc = serve("eof")
    const code = await proc.exited
    expect(code).toBe(0)
  }, 15000)

  test("serves while held, exits after EOF", async () => {
    const proc = serve("pipe")
    const writer = proc.stdin
    if (typeof writer === "number" || writer === null || writer === undefined) {
      throw new Error("expected piped stdin")
    }
    writer.write(
      `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}\n`
    )
    const reader = proc.stdout
    if (typeof reader === "number" || reader === null || reader === undefined) {
      proc.kill()
      throw new Error("expected piped stdout")
    }
    const decoder = new TextDecoder()
    let buf = ""
    for await (const chunk of reader as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk)
      if (buf.includes("\n")) break
    }
    expect(buf).toContain("agent-webmcp")
    writer.end()
    const code = await proc.exited
    expect(code).toBe(0)
  }, 15000)
})
