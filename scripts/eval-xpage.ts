// Unit 7 eval: cross-page composition over stdio, no model. Usage:
// `bun run eval:xpage`. Manual (needs chromium; NO network — fixtures
// are served locally by this script).
// open flights + hotel fixtures -> multi-session search tags both ->
// execute code joins across sessions (origins[] + perSession) ->
// fault-injected booking fails -> compensation in code (releaseHold) ->
// close both. Proves the xpage vision; single-page mechanics stay in
// eval:mcp.
import { Console, Effect } from "effect"
import { check, makeRpc, startServer, textOf } from "./eval-lib.ts"
import type { McpServer } from "./eval-lib.ts"

// Fixture scripts use string concat, never backticks/${}: this file
// contains template literals for the HTML, so fixture JS must survive
// embedding byte-identical (a ${} in fixture code would interpolate
// at eval-script parse time, not in the browser).
const FLIGHTS_HTML = `<!doctype html><html><head><title>Fixture flights</title></head>
<body><h1>Fixture flights</h1>
<script>
document.modelContext.registerTool({
  name: "searchFlights",
  description: "Search fixture flights.",
  inputSchema: { type: "object", properties: { origin: { type: "string" }, destination: { type: "string" } }, required: ["origin", "destination"] },
  annotations: { readOnlyHint: true },
  execute: async () => JSON.stringify([{ id: "F1", price: 500 }, { id: "F2", price: 700 }])
});
document.modelContext.registerTool({
  name: "holdFlight",
  description: "Hold a flight id. Reversible via releaseHold.",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  annotations: { readOnlyHint: false },
  execute: async (args) => JSON.stringify({ held: args.id })
});
document.modelContext.registerTool({
  name: "releaseHold",
  description: "Release a held flight id (compensation).",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  annotations: { readOnlyHint: false },
  execute: async (args) => JSON.stringify({ released: args.id })
});
document.modelContext.registerTool({
  name: "quote",
  description: "Same-name overlap tool (flights side).",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true },
  execute: async () => "flights from F"
});
</script></body></html>`

const HOTEL_HTML = `<!doctype html><html><head><title>Fixture hotel</title></head>
<body><h1>Fixture hotel</h1>
<script>
document.modelContext.registerTool({
  name: "searchRooms",
  description: "Search fixture rooms.",
  inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  annotations: { readOnlyHint: true },
  execute: async () => JSON.stringify([{ id: "H1", price: 200 }])
});
document.modelContext.registerTool({
  name: "bookRoom",
  description: "Book a room id. Throws when args.fail is true (fault injection).",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  annotations: { readOnlyHint: false },
  execute: async (args) => {
    if (args.fail === true) throw new Error("simulated booking failure");
    return JSON.stringify({ booked: args.id });
  }
});
document.modelContext.registerTool({
  name: "cancelBooking",
  description: "Cancel a booking id (compensation).",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  annotations: { readOnlyHint: false },
  execute: async (args) => JSON.stringify({ cancelled: args.id })
});
document.modelContext.registerTool({
  name: "quote",
  description: "Same-name overlap tool (hotel side).",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true },
  execute: async () => "rooms from H"
});
</script></body></html>`

// Harness from ./eval-lib.ts (shared pump, rpc, check).

const main = Effect.fn("eval.main")(function* () {
  const results: Array<boolean> = []
  // Fixtures ride acquireRelease: early returns and failures unwind
  // through finalizers, never inline stops.
  yield* Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: (req) => {
            const path = new URL(req.url).pathname
            if (path === "/flights.html") {
              return new Response(FLIGHTS_HTML, { headers: { "Content-Type": "text/html" } })
            }
            if (path === "/hotel.html") {
              return new Response(HOTEL_HTML, { headers: { "Content-Type": "text/html" } })
            }
            return new Response("not found", { status: 404 })
          }
        })
      ),
      (fixtures) =>
        Effect.sync(() => {
          fixtures.stop()
        })
    ).pipe(
      Effect.flatMap((fixtures) => {
        const base = `http://127.0.0.1:${fixtures.port}`
        // Single teardown owner: the acquireRelease release. (An inner
        // ensuring here would double-stop; SIGKILL idempotence would
        // save it, discipline doesn't need it.)
        return Effect.acquireRelease(
          Effect.sync(() => startServer()),
          (server) => Effect.sync(() => server.stop())
        ).pipe(
          Effect.flatMap((server) => runChecks(server, results, base))
        )
      })
    )
  )
  return results.every(Boolean) ? 0 : 1
})

const runChecks = Effect.fn("eval.checks")(function* (
  server: McpServer,
  results: Array<boolean>,
  base: string
) {
  const { rpc, detail } = makeRpc(server)

  const init = (yield* rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "eval-xpage", version: "0.0.0" }
  })) as { result?: { serverInfo?: { name?: string } } } | null
  results.push(yield* check("initialize", init?.result?.serverInfo?.name === "agent-webmcp", detail(JSON.stringify(init?.result?.serverInfo ?? null))))
  server.notify("notifications/initialized", {})

  const openStartF = Date.now()
  const openF = textOf(yield* rpc("tools/call", {
    name: "open",
    arguments: { url: `${base}/flights.html` }
  }))
  const openMsF = Date.now() - openStartF
  const openStartH = Date.now()
  const openH = textOf(yield* rpc("tools/call", {
    name: "open",
    arguments: { url: `${base}/hotel.html` }
  }))
  const openMsH = Date.now() - openStartH
  // Report-only (see eval-mcp): opens getting slower must be visible.
  yield* Console.log(`open_ms: flights=${openMsF} hotel=${openMsH} (report-only)`)
  let hF = ""
  let hH = ""
  let nF = -1
  let nH = -1
  try {
    hF = (JSON.parse(openF) as { handle: string }).handle
    hH = (JSON.parse(openH) as { handle: string }).handle
    nF = (JSON.parse(openF) as { toolCount: number }).toolCount
    nH = (JSON.parse(openH) as { toolCount: number }).toolCount
  } catch {}
  const handlesOk = /^s_[a-z0-9]+$/.test(hF) && /^s_[a-z0-9]+$/.test(hH) && hF !== hH
  results.push(yield* check("open-both", handlesOk, detail(`${hF} ${hH}`)))
  results.push(yield* check("open-toolcounts", nF >= 1 && nH >= 1, detail(`flights=${nF} hotel=${nH}`)))
  if (!handlesOk) {
    // Close whatever opened before bailing: a half-open pair leaks a
    // browser/target otherwise (finalizers own servers, not sessions).
    for (const handle of [hF, hH]) {
      if (/^s_[a-z0-9]+$/.test(handle)) {
        yield* rpc("tools/call", { name: "close", arguments: { handle } }).pipe(
          Effect.ignore
        )
      }
    }
    return 1
  }

  // Multi-session search: the same-name `quote` tool resolves on both
  // pages, tagged per session.
  const searched = textOf(yield* rpc("tools/call", {
    name: "search",
    arguments: { query: "quote", handles: [hF, hH] }
  }))
  let searchOk = false
  try {
    const report = JSON.parse(searched) as { tools: Array<{ name: string; session: string | null }> }
    const tagged = report.tools.filter((t) => t.name === "quote").map((t) => t.session).sort()
    searchOk = JSON.stringify(tagged) === JSON.stringify([hF, hH].sort())
  } catch {}
  results.push(yield* check("multisearch-tags", searchOk, detail(searched.slice(0, 120))))

  // Cross-page join in ONE code block: quote both pages, compare in
  // code. origins[] carries both fixture URLs (multi-origin honesty),
  // perSession counts each alias once.
  const joined = textOf(yield* rpc("tools/call", {
    name: "execute",
    arguments: {
      sessions: { f: hF, h: hH },
      code: `const fq = await sesh.f.tools.quote({});
        const hq = await sesh.h.tools.quote({});
        return { f: fq, h: hq, same: fq === hq };`
    }
  }))
  let joinOk = false
  try {
    const report = JSON.parse(joined) as {
      value: string; untrusted: boolean; toolCalls: number;
      perSession: Record<string, number>; origins: Array<string>
    }
    const inner = JSON.parse(report.value) as { f: string; h: string; same: boolean }
    joinOk = report.untrusted === true
      && inner.f === "flights from F"
      && inner.h === "rooms from H"
      && inner.same === false
      && report.toolCalls === 2
      && report.perSession["f"] === 1
      && report.perSession["h"] === 1
      && report.origins.length === 2
      && report.origins.some((o) => o.includes("flights.html"))
      && report.origins.some((o) => o.includes("hotel.html"))
  } catch {}
  results.push(yield* check("code-join", joinOk, detail(joined.slice(0, 120))))

  // Compensation in code: hold the flight, force the booking to fail
  // (fault injection via args — deterministic, no timing), release
  // the hold in catch. Rollback is code, not durable: no log, replay,
  // or snippets on our side by design.
  const compensated = textOf(yield* rpc("tools/call", {
    name: "execute",
    arguments: {
      sessions: { f: hF, h: hH },
      code: `const J = async (p) => { const v = await p; return typeof v === "string" ? JSON.parse(v) : v; };
        const hold = await J(sesh.f.tools.holdFlight({ id: "F1" }));
        let booked = null;
        let released = null;
        try {
          booked = await J(sesh.h.tools.bookRoom({ id: "H1", fail: true }));
        } catch (e) {
          released = await J(sesh.f.tools.releaseHold({ id: "F1" }));
        }
        return { held: hold.held, booked, compensated: released !== null, released: released === null ? null : released.released };`
    }
  }))
  let compOk = false
  try {
    const report = JSON.parse(compensated) as { value: string; untrusted: boolean }
    const inner = JSON.parse(report.value) as { held: string; booked: unknown; compensated: boolean; released: string | null }
    compOk = report.untrusted === true
      && inner.held === "F1"
      && inner.booked === null
      && inner.compensated === true
      && inner.released === "F1"
  } catch {}
  results.push(yield* check("compensation", compOk, detail(compensated.slice(0, 120))))

  const closedF = textOf(yield* rpc("tools/call", {
    name: "close",
    arguments: { handle: hF }
  }))
  const closedH = textOf(yield* rpc("tools/call", {
    name: "close",
    arguments: { handle: hH }
  }))
  results.push(yield* check(
    "close-both",
    closedF.includes(hF) && closedH.includes(hH),
    detail(`${closedF.slice(0, 40)} ${closedH.slice(0, 40)}`)
  ))
})

const exit = await Effect.runPromiseExit(main())
process.exit(exit._tag === "Success" ? exit.value : 1)
