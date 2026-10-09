// Shared eval harness: one stdio JSON-RPC pump, one check printer, one
// envelope splitter. Usage: `import { startServer, makeRpc, check,
// textOf, splitReport } from "./eval-lib.ts"`. No browser, no network,
// no model by itself — the driver underneath still needs chromium.
//
// Replaces four copies of the pump (G15) and every hand-rolled envelope
// parse. splitReport knows the spill contract: spilled values resolve
// through the file, inline values parse direct — asserts never care
// which (the directories eval bled on exactly this).
import { Console, Effect } from "effect"

export interface McpServer {
  readonly call: (method: string, params: unknown) => Promise<unknown>
  readonly notify: (method: string, params: unknown) => void
  readonly stop: () => void
  readonly errTail: Array<string>
}

export const startServer = (opts?: { timeoutMs?: number }): McpServer => {
  const timeoutMs = opts?.timeoutMs ?? 60000
  const entry = `${import.meta.dir}/../src/main.ts`
  const proc = Bun.spawn(["bun", entry, "mcp", "serve"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe"
  })
  let nextId = 1
  const pending = new Map<number, (msg: unknown) => void>()
  const errTail: Array<string> = []
  let buffer = ""
  // Fire-and-forget pump by design: appends to locals the fiber reads
  // after awaits. The manual timer below owns map hygiene.
  const pump = (async () => {
    const reader = proc.stdout.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += new TextDecoder().decode(value)
      const parts = buffer.split("\n")
      buffer = parts.pop() ?? ""
      for (const line of parts) {
        const text = line.trim()
        if (text === "") continue
        try {
          const msg = JSON.parse(text) as { id?: number }
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)?.(msg)
            pending.delete(msg.id)
          }
        } catch {}
      }
    }
  })()
  void pump
  const drainErr = (async () => {
    const reader = proc.stderr.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      errTail.push(new TextDecoder().decode(value))
      if (errTail.length > 20) errTail.shift()
    }
  })()
  void drainErr
  const call = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, resolve)
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`mcp timeout on ${method}`))
      }, timeoutMs)
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  const notify = (method: string, params: unknown): void => {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
  }
  return {
    call,
    notify,
    stop: () => {
      try {
        proc.kill("SIGKILL")
      } catch {}
    },
    errTail
  }
}

export const check = Effect.fn("eval.check")(function* (name: string, cond: boolean, detail: string) {
  yield* Console.log(`${cond ? "PASS" : "FAIL"} ${name} :: ${detail.slice(0, 120)}`)
  return cond
})

export const textOf = (response: unknown): string => {
  const content = (response as { result?: { content?: Array<{ text?: string }> } }).result?.content
  return content?.map((c) => c.text ?? "").join("\n") ?? ""
}

export const makeRpc = (server: McpServer): {
  rpc: (method: string, params: unknown) => Effect.Effect<unknown>
  detail: (text: string) => string
} => {
  // Last rpc failure, preserved for check detail: a crashed serve must
  // report its cause, never FAIL with empty detail.
  let lastError = ""
  const rpc = (method: string, params: unknown): Effect.Effect<unknown> =>
    Effect.tryPromise(() => server.call(method, params)).pipe(
      Effect.catch((cause) => {
        lastError = String(cause)
        return Effect.succeed(null)
      })
    )
  const detail = (text: string): string =>
    text !== "" ? text : `rpc failed: ${lastError}${server.errTail.length > 0 ? ` :: serve stderr: ${server.errTail.join("").slice(-300)}` : ""}`
  return { rpc, detail }
}

// Pure splitter, no IO: spilled bodies resolve through the file
// (callers read via Effect — fibers honor the wrapped-side-effects
// law), inline values parse direct. Throws on malformed input — call
// sites already try/catch per check.
export const splitReport = (text: string): { spilled: string } | { inline: string } => {
  const report = JSON.parse(text) as { value: string; spilled: unknown }
  if (typeof report.spilled === "string" && report.spilled !== "") return { spilled: report.spilled }
  return { inline: report.value }
}
