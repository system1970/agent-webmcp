// Unit 13 eval: the MCP surface over stdio, no model. Usage:
// `bun run eval:mcp`. Manual (needs network + chromium).
// initialize -> tools/list (6 tools) -> call open (toolCount + open_ms)
// -> execute single-call (normalized output, untrusted:true) ->
// search/list w/ session -> execute code block (invoke in code) ->
// spilling execute (big code value) -> execute control-flow
// (loop/branch/filter in-code) -> call close.
//
// Harness from ./eval-lib.ts (shared pump, rpc, check, splitReport).
import { Console, Effect } from "effect"
import { check, makeRpc, splitReport, startServer, textOf } from "./eval-lib.ts"
import type { McpServer } from "./eval-lib.ts"

const DEMO = "https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/"

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
  const { rpc, detail } = makeRpc(server)

  const init = (yield* rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "eval-mcp", version: "0.0.0" }
  })) as { result?: { serverInfo?: { name?: string } } } | null
  results.push(yield* check("initialize", init?.result?.serverInfo?.name === "agent-webmcp", detail(JSON.stringify(init?.result?.serverInfo ?? null))))
  server.notify("notifications/initialized", {})

  const listed = (yield* rpc("tools/list", {})) as {
    result: { tools: Array<{ name: string; inputSchema?: { type?: unknown } }> }
  } | null
  const names = listed?.result.tools.map((t) => t.name).sort() ?? []
  const want = ["close", "execute", "list", "open", "register", "search"]
  results.push(yield* check(
    "tools-list-6",
    want.every((n) => names.includes(n)),
    detail(names.join(","))
  ))
  // Wire-level MCP contract: EVERY tool's inputSchema is top-level
  // {type:"object"} — opencode rejects the whole list on one typeless
  // tool (status shipped anyOf; gate schema-object locks it
  // import-time, this locks what actually crosses stdio).
  const schemasOk = (listed?.result.tools ?? []).length === 6
    && (listed?.result.tools ?? []).every((t) => t.inputSchema?.type === "object")
  results.push(yield* check(
    "tools-schemas-object",
    schemasOk,
    detail((listed?.result.tools ?? []).map((t) => `${t.name}:${String(t.inputSchema?.type)}`).join(","))
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
    // Single calls ride code blocks (no one-per-turn verb): the value
    // arrives normalized with the untrusted envelope.
    const invoked = textOf(yield* rpc("tools/call", {
      name: "execute",
      arguments: {
        handle,
        code: `return await tools.searchFlights({ origin: "SFO", destination: "JFK" });`
      }
    }))
    try {
      const report = JSON.parse(invoked) as { value: string; toolCalls: number; untrusted: boolean; origins: Array<string> }
      invokedOk = report.toolCalls === 1 && JSON.parse(report.value) !== undefined
      untrustedOk = report.untrusted === true && report.origins.length === 1 && typeof report.origins[0] === "string"
    } catch {}
    results.push(yield* check("call-single", invokedOk, detail(invoked.slice(0, 80))))
    results.push(yield* check("single-untrusted", untrustedOk, detail(invoked.slice(0, 120))))

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
      name: "list",
      arguments: { handle, tool: "searchFlights" }
    }))
    let describeOk = false
    try {
      const record = JSON.parse(described) as { name: string; inputSchema: { properties: { origin: unknown } }; untrusted: boolean }
      describeOk = record.name === "searchFlights" &&
        typeof record.inputSchema.properties.origin === "object" &&
        record.untrusted === true
    } catch {}
    results.push(yield* check("list-record", describeOk, detail(described.slice(0, 120))))

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
      // splitReport is pure (no IO): the spill file resolves through
      // Effect below. Double-parse: the code returns JSON.stringify
      // (a string), so the filed body is stringified twice; each
      // element is one listFlights result array.
      const parts = splitReport(spilling)
      if ("spilled" in parts) {
        const body = yield* Effect.tryPromise(() => Bun.file(parts.spilled).text()).pipe(
          Effect.catch(() => Effect.succeed(null))
        )
        if (body !== null) {
          const decoded = JSON.parse(body) as unknown
          const rows = (typeof decoded === "string" ? JSON.parse(decoded) : decoded) as unknown
          spillOk = Array.isArray(rows) && rows.length === 5 && rows.every(Array.isArray)
        }
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
