// Unit 8 eval: the MCP surface over stdio, no model. Usage:
// `bun run eval:mcp`. Manual (needs network + chromium).
// initialize -> tools/list (8 tools) -> call open (toolCount + open_ms)
// -> call invoke (Completed, normalized output, untrusted:true) ->
// search/describe w/ session -> execute code block (invoke in code) ->
// spilling execute (big code value) -> execute control-flow
// (loop/branch/filter in-code) -> call status -> call close.
import { Console, Effect } from "effect"

const DEMO = "https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/"

// Minimal JSON-RPC client over a spawned `mcp serve`. One writer, one
// line-reader; responses matched by id.
interface McpServer {
  readonly call: (method: string, params: unknown) => Promise<unknown>
  readonly notify: (method: string, params: unknown) => void
  readonly stop: () => void
  readonly errTail: Array<string>
}

const startServer = (): McpServer => {
  // Resolved from the script's own dir: the eval must run from any cwd.
  const entry = `${import.meta.dir}/../src/main.ts`
  const proc = Bun.spawn(["bun", entry, "mcp", "serve"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe"
  })
  let nextId = 1
  const pending = new Map<number, (msg: unknown) => void>()
  const lines: Array<string> = []
  const errTail: Array<string> = []
  let buffer = ""
  // Fire-and-forget pump by design: it only appends to locals the fiber
  // reads after awaits. The manual timer below (not Effect.timeout) owns
  // map hygiene — an outer interrupt cannot clean a callback map.
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
          } else {
            lines.push(text)
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
      }, 60000)
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  const notify = (method: string, params: unknown): void => {
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
  }
  const stop = (): void => {
    try {
      proc.kill("SIGKILL")
    } catch {}
  }
  const server: McpServer = { call, notify, stop, errTail }
  return server
}

const check = Effect.fn("eval.check")(function* (name: string, cond: boolean, detail: string) {
  yield* Console.log(`${cond ? "PASS" : "FAIL"} ${name} :: ${detail.slice(0, 100)}`)
  return cond
})

const textOf = (response: unknown): string => {
  const content = (response as { result?: { content?: Array<{ text?: string }> } }).result?.content
  return content?.map((c) => c.text ?? "").join("\n") ?? ""
}

const main = Effect.fn("eval.main")(function* () {
  const results: Array<boolean> = []
  const server = yield* Effect.sync(() => startServer())
  // Proc lifetime is scope-free but not structureless: ensuring stops the
  // server however the body ends (the sync callbacks inside stay raw —
  // they only touch locals, documented at startServer).
  return yield* Effect.ensuring(
    runChecks(server, results),
    Effect.sync(() => server.stop())
  )
})

const runChecks = Effect.fn("eval.checks")(function* (
  server: McpServer,
  results: Array<boolean>
) {
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

  const init = (yield* rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "eval-mcp", version: "0.0.0" }
  })) as { result?: { serverInfo?: { name?: string } } } | null
  results.push(yield* check("initialize", init?.result?.serverInfo?.name === "agent-webmcp", detail(JSON.stringify(init?.result?.serverInfo ?? null))))
  server.notify("notifications/initialized", {})

  const listed = (yield* rpc("tools/list", {})) as {
    result: { tools: Array<{ name: string }> }
  } | null
  const names = listed?.result.tools.map((t) => t.name).sort() ?? []
  const want = ["close", "describe", "execute", "invoke", "list", "open", "search", "status"]
  results.push(yield* check(
    "tools-list-8",
    want.every((n) => names.includes(n)),
    detail(names.join(","))
  ))

  const openStart = Date.now()
  const opened = textOf(yield* rpc("tools/call", {
    name: "open",
    arguments: { url: DEMO }
  }))
  const openMs = Date.now() - openStart
  // Report-only: machine variance makes thresholds flaky or meaningless —
  // the number exists so opens getting slower is visible, not gated.
  yield* Console.log(`open_ms: ${openMs} (report-only)`)
  let handle = ""
  let toolCount = -1
  try {
    const parsed = JSON.parse(opened) as { handle: string; toolCount: number }
    handle = parsed.handle
    toolCount = parsed.toolCount
  } catch {}
  results.push(yield* check(
    "call-open",
    handle.startsWith("s_") && toolCount >= 1,
    detail(`${opened.slice(0, 60)} open_ms=${openMs}`)
  ))

  let invokedOk = false
  let untrustedOk = false
  if (handle !== "") {
    const invoked = textOf(yield* rpc("tools/call", {
      name: "invoke",
      arguments: { handle, tool: "searchFlights", args: { origin: "SFO", destination: "JFK" } }
    }))
    try {
      const report = JSON.parse(invoked) as { status: string; untrusted: boolean; origin: string }
      invokedOk = report.status === "Completed"
      untrustedOk = report.untrusted === true && typeof report.origin === "string"
    } catch {}
    results.push(yield* check("call-invoke", invokedOk, detail(invoked.slice(0, 80))))
    results.push(yield* check("invoke-untrusted", untrustedOk, detail(invoked.slice(0, 120))))

    const searched = textOf(yield* rpc("tools/call", {
      name: "search",
      arguments: { query: "flights", handle }
    }))
    let sessionHit = false
    try {
      const report = JSON.parse(searched) as { tools: Array<{ name: string; session: string | null }> }
      sessionHit = report.tools.some((t) => t.session === handle)
    } catch {}
    results.push(yield* check("search-session", sessionHit, detail(searched.slice(0, 120))))

    const described = textOf(yield* rpc("tools/call", {
      name: "describe",
      arguments: { handle, tool: "searchFlights" }
    }))
    let describeOk = false
    try {
      const record = JSON.parse(described) as { name: string; inputSchema: { properties: { origin: unknown } }; untrusted: boolean }
      describeOk = record.name === "searchFlights" &&
        typeof record.inputSchema.properties.origin === "object" &&
        record.untrusted === true
    } catch {}
    results.push(yield* check("describe-record", describeOk, detail(described.slice(0, 120))))

    const batched = textOf(yield* rpc("tools/call", {
      name: "execute",
      arguments: {
        handle,
        code: `const r = await tools.searchFlights({ origin: "SFO", destination: "JFK" });
          return { searched: typeof r, value: String(r).slice(0, 80) };`
      }
    }))
    let batchOk = false
    try {
      const report = JSON.parse(batched) as { value: string; toolCalls: number; untrusted: boolean }
      const inner = JSON.parse(report.value) as { searched: string; value: string }
      // L6 consumption lock: the demo's searchFlights returns a string,
      // so normalized code-level output IS the string — never an MCP
      // envelope ({content, structuredContent}) leaking into code.
      // Shape-only: the live demo varies its text run to run (UI
      // timing), so only non-emptiness is pinned, never the words.
      batchOk = inner.searched === "string" && inner.value.length > 0
        && report.toolCalls === 1 && report.untrusted === true
    } catch {}
    results.push(yield* check("execute-session", batchOk, detail(batched.slice(0, 120))))

    // Spill contract, both sides, via the structured field (see
    // spill.ts): overflow names a matching file, fit carries no key.
    // Five page reads in code, one turn total — past budget by design.
    const spilling = textOf(yield* rpc("tools/call", {
      name: "execute",
      arguments: {
        handle,
        code: `const out = [];
          for (let i = 0; i < 5; i++) { out.push(await tools.listFlights({})); }
          return JSON.stringify(out);`,
        maxChars: 1000
      }
    }))
    let spillOk = false
    try {
      const report = JSON.parse(spilling) as { value: string; spilled: unknown; untrusted: boolean }
      if (typeof report.spilled === "string" && report.spilled !== "" && report.untrusted === true) {
        const body = yield* Effect.tryPromise(() => Bun.file(report.spilled as string).text()).pipe(
          Effect.catch(() => Effect.succeed(""))
        )
        spillOk = body.length > 1000 && report.value.startsWith(body.slice(0, 500))
      }
    } catch {}
    results.push(yield* check("execute-spill", spillOk, detail(spilling.slice(0, 120))))

    const ran = textOf(yield* rpc("tools/call", {
      name: "execute",
      arguments: {
        handle,
        code: `const names = ["searchFlights", "listFlights"];
          const described = [];
          const found = [];
          const ok = [];
          for (const name of names) {
            const d = await describe(name);
            described.push(d.name);
            const schema = d.inputSchema || {};
            const args = {};
            for (const k of (schema.required || [])) args[k] = "x";
            try { await tools[name](args);
              found.push(name); ok.push(name);
            } catch (e) { found.push("miss:" + name); }
          }
          return { described, found, ok };`
      }
    }))
    let runOk = false
    let runDetail = ""
    try {
      const report = JSON.parse(ran) as {
        value: string; untrusted: boolean; toolCalls: number;
        perSession: Record<string, number>; origins: Array<string>
      }
      const inner = JSON.parse(report.value) as { described: Array<string>; found: Array<string>; ok: Array<string> }
      runDetail = report.value.slice(0, 160)
      // Control-flow shape plus one live success: describe-first loop
      // order pinned, each arm recorded success-or-miss, and at least
      // one invoke genuinely succeeded — a fully-missing bridge would
      // stay green on shape alone. (If page-side validation ever
      // rejects the placeholder args, this anchor goes red and the
      // eval gets real args — that failure is signal, not noise.)
      // Single handle: both attempts counted under it, one origin.
      const names = ["searchFlights", "listFlights"]
      runOk = report.untrusted === true
        && JSON.stringify(inner.described) === JSON.stringify(names)
        && inner.found.length === 2
        && inner.found.every((n) => names.includes(n) || n.startsWith("miss:"))
        && inner.ok.every((n) => names.includes(n))
        && inner.ok.length >= 1
        && report.toolCalls === 2
        && report.perSession[handle] === 2
        && report.origins.length === 1
    } catch {}
    results.push(yield* check("execute-control-flow", runOk, detail(runDetail === "" ? ran.slice(0, 120) : runDetail)))

    const small = textOf(yield* rpc("tools/call", {
      name: "describe",
      arguments: { tool: "search" }
    }))
    let fitOk = false
    try {
      const record = JSON.parse(small) as { name: string; spill?: unknown }
      fitOk = record.name === "search" && !("spill" in record)
    } catch {}
    results.push(yield* check("describe-fits", fitOk, detail(small.slice(0, 120))))

    // Status is records-only: the open session must be listed, spill
    // stats must be numbers — and the call must not disturb the session
    // (invoke still works after; close still closes).
    const stated = textOf(yield* rpc("tools/call", {
      name: "status",
      arguments: {}
    }))
    let statusOk = false
    try {
      const report = JSON.parse(stated) as {
        sessions: Array<{ handle: string; url: string }>; spill: { files: number; bytes: number }
      }
      statusOk = report.sessions.some((s) => s.handle === handle && typeof s.url === "string")
        && typeof report.spill.files === "number" && typeof report.spill.bytes === "number"
    } catch {}
    results.push(yield* check("call-status", statusOk, detail(stated.slice(0, 120))))

    // Records-only proof: invoke on the same session AFTER status —
    // a status check that disturbed live sessions would break this.
    const after = textOf(yield* rpc("tools/call", {
      name: "invoke",
      arguments: { handle, tool: "searchFlights", args: { origin: "SFO", destination: "JFK" } }
    }))
    let afterOk = false
    try {
      afterOk = (JSON.parse(after) as { status: string }).status === "Completed"
    } catch {}
    results.push(yield* check("status-undisturbed", afterOk, detail(after.slice(0, 80))))

    const closed = textOf(yield* rpc("tools/call", {
      name: "close",
      arguments: { handle }
    }))
    results.push(yield* check("call-close", closed.includes(handle), detail(closed.slice(0, 80))))
  }

  server.stop()
  return results.every(Boolean) ? 0 : 1
})

const exit = await Effect.runPromiseExit(main())
process.exit(exit._tag === "Success" ? exit.value : 1)
