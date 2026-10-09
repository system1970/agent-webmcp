// Unit 13 eval: agent-driven authoring against Cloudflare docs over
// stdio, no model. Usage: `bun run eval:cloudflare`. Manual (needs
// network + chromium).
// open (toolCount 0: their tools live on navigator, not document) ->
// register bridge tool -> execute it (re-dispatch runs their registrar)
// -> list shows THEIR first-party tools (search, list-directories) ->
// execute single-calls (live AI backend, shape-only) -> register custom
// topHits -> execute it -> execute join through code -> close.
//
// Why this matters: the page authors first-party tools but gates them
// on navigator.modelContext, which flagless browsers lack. Our flagged
// headless HAS the real document.modelContext — the bridge is 10 lines
// and everything downstream is native (CDP invoke, their backend).
// Values assert shapes/counts only (vendor backend varies); decisions.md
// forbids pin-exact.
import { Console, Duration, Effect } from "effect"
import { check, makeRpc, splitReport, startServer, textOf } from "./eval-lib.ts"
import type { McpServer } from "./eval-lib.ts"

const DOCS = "https://developers.cloudflare.com/"

// Bridge as a REGISTERED tool: defineProperty + re-dispatch run as
// the body of a session-scoped tool, invoked once through code. After
// this, their registrar runs natively and everything downstream is
// native (CDP invoke, their backend).
const BRIDGE_TOOL = {
  name: "__awmBridgeNav",
  description: "Bridge navigator.modelContext to the real document surface and re-run page registrars.",
  inputSchema: { type: "object", properties: {} },
  annotations: {}
}
const BRIDGE_BODY = `async () => {
  if (navigator.modelContext) return "native";
  const real = document.modelContext;
  Object.defineProperty(navigator, "modelContext", { value: {
    registerTool: (t) => real.registerTool(t),
    getTools: () => real.getTools(),
    executeTool: (n, a) => real.executeTool(n, a)
  }, configurable: true });
  document.dispatchEvent(new Event("astro:page-load"));
  return "bridged+redispatched";
}`

// Custom authoring on their backend: topHits composes THEIR search API
// (same fetch their native tool uses) with a page fetch — a custom tool
// their site never published. (Their chat path, .../ai-search/ai-search,
// 403s preflight for everyone including their own UI — fenced
// server-side, not authorable. Verified 2026-10-09; cut, not chased.)
const TOPHITS_TOOL = {
  name: "topHits",
  description: "Search Cloudflare docs and return the top hits plus the first result page as text.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  annotations: {}
}
const TOPHITS_BODY = `async (args) => {
  const s = await fetch("https://ai-search.developers.cloudflare.com/api/ai-search/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "cf-ai-search-source": "snippet-search" },
    body: JSON.stringify({ messages: [{ role: "user", content: args.query }], stream: false, ai_search_options: { retrieval: { metadata_only: true, max_num_results: 3 } } })
  });
  if (!s.ok) throw new Error("search failed: " + s.status);
  const j = await s.json();
  const hits = ((j.result && j.result.chunks) || []).map((c) => ({ title: c.item && c.item.metadata && c.item.metadata.title, url: c.item && c.item.key }));
  let page = "";
  if (hits[0] && hits[0].url) {
    const p = await fetch(new URL(hits[0].url, "https://developers.cloudflare.com").toString());
    if (p.ok) page = (await p.text()).replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").slice(0, 2000);
  }
  return JSON.stringify({ hits, page });
}`

const main = Effect.fn("eval.main")(function* () {
  const results: Array<boolean> = []
  const server = yield* Effect.sync(() => startServer({ timeoutMs: 90000 }))
  return yield* Effect.ensuring(runChecks(server, results), Effect.sync(() => server.stop()))
})

const runChecks = Effect.fn("eval.checks")(function* (
  server: McpServer,
  results: Array<boolean>
) {
  const { rpc, detail } = makeRpc(server)

  const init = (yield* rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "eval-cloudflare", version: "0.0.0" }
  })) as { result?: { serverInfo?: { name?: string } } } | null
  results.push(yield* check("initialize", init?.result?.serverInfo?.name === "agent-webmcp", detail(JSON.stringify(init?.result?.serverInfo ?? null))))

  // Their tools live on navigator, not document: open reads 0.
  // Point-in-time count, shape only (never gate on vendor timing).
  const openStart = Date.now()
  const opened = textOf(yield* rpc("tools/call", { name: "open", arguments: { url: DOCS } }))
  const openMs = Date.now() - openStart
  yield* Console.log(`open_ms: docs=${openMs} (report-only)`)
  let handle = ""
  let n0 = -1
  try {
    const parsed = JSON.parse(opened) as { handle: string; toolCount: number }
    handle = parsed.handle
    n0 = parsed.toolCount
  } catch {}
  const openedOk = handle.startsWith("s_") && Number.isInteger(n0) && n0 >= 0
  results.push(yield* check("call-open", openedOk, detail(`${opened.slice(0, 60)} open_ms=${openMs}`)))
  if (!openedOk) return 1

  // Bridge + re-dispatch via register: their registrar runs natively
  // from here. Registration is a verb; firing it is one code block.
  const bridgedReg = textOf(yield* rpc("tools/call", {
    name: "register",
    arguments: { handle, tool: BRIDGE_TOOL, code: BRIDGE_BODY }
  }))
  let bridgeRegOk = false
  try {
    bridgeRegOk = (JSON.parse(bridgedReg) as { tool: string }).tool === "__awmBridgeNav"
  } catch {}
  results.push(yield* check("register-bridge", bridgeRegOk, detail(bridgedReg.slice(0, 80))))
  const bridged = textOf(yield* rpc("tools/call", {
    name: "execute",
    arguments: { handle, code: `return await tools.__awmBridgeNav({});` }
  }))
  let bridgeOk = false
  try {
    const report = JSON.parse(bridged) as { value: string }
    bridgeOk = (JSON.parse(report.value) as string) === "bridged+redispatched"
  } catch {}
  results.push(yield* check("fire-bridge", bridgeOk, detail(bridged.slice(0, 80))))

  // Their first-party tools now in OUR catalog (windowed list settles
  // late registrants — retry the list a few times, bounded).
  let names: Array<string> = []
  for (let i = 0; i < 5 && !(names.includes("search") && names.includes("list-directories")); i++) {
    if (i > 0) yield* Effect.sleep(Duration.millis(2000))
    const listed = textOf(yield* rpc("tools/call", { name: "list", arguments: { handle } }))
    try {
      names = (JSON.parse(listed) as { tools: Array<{ name: string }> }).tools.map((t) => t.name)
    } catch {}
  }
  results.push(yield* check(
    "cf-tools-registered",
    names.includes("search") && names.includes("list-directories"),
    detail(names.join(","))
  ))

  // list-directories: shape only (array, entries with name + url).
  // Single calls ride code blocks.
  const dirs = textOf(yield* rpc("tools/call", {
    name: "execute",
    arguments: { handle, code: `return await tools["list-directories"]({});` }
  }))
  let dirsOk = false
  try {
    // splitReport is pure (no IO): the spill file resolves through
    // Effect — the directories array exceeds budget, so inline-parse
    // fails by design here.
    const parts = splitReport(dirs)
    const raw = "spilled" in parts
      ? yield* Effect.tryPromise(() => Bun.file(parts.spilled).text()).pipe(
        Effect.catch(() => Effect.succeed("null"))
      )
      : parts.inline
    const out = JSON.parse(raw) as Array<{ name: unknown; url: unknown }>
    const usable = Array.isArray(out)
      ? out.filter((d) => typeof d.name === "string" && typeof d.url === "string")
      : []
    dirsOk = usable.length >= 10
  } catch {}
  results.push(yield* check("fire-directories", dirsOk, detail(dirs.slice(0, 120))))

  // Their AI backend, live: chunks with title + url (values vary — shapes only).
  const searched = textOf(yield* rpc("tools/call", {
    name: "execute",
    arguments: { handle, code: `return await tools.search({ query: "workers KV read", limit: 3 });` }
  }))
  let searchOk = false
  try {
    const report = JSON.parse(searched) as { value: string }
    const out = JSON.parse(report.value) as Array<{ title: string; url: string }>
    searchOk = Array.isArray(out) && out.length >= 1
      && out.every((c) => typeof c.title === "string" && typeof c.url === "string")
  } catch {}
  results.push(yield* check("fire-cf-search", searchOk, detail(searched.slice(0, 120))))

  // Custom authoring on their backend: topHits wires search + page
  // fetch into one tool their site never published.
  const crafted = textOf(yield* rpc("tools/call", {
    name: "register",
    arguments: { handle, tool: TOPHITS_TOOL, code: TOPHITS_BODY }
  }))
  let craftOk = false
  try {
    craftOk = (JSON.parse(crafted) as { tool: string }).tool === "topHits"
  } catch {}
  results.push(yield* check("register-tophits", craftOk, detail(crafted.slice(0, 80))))
  const asked = textOf(yield* rpc("tools/call", {
    name: "execute",
    arguments: { handle, code: `return await tools.topHits({ query: "workers KV read" });` }
  }))
  let askOk = false
  try {
    const report = JSON.parse(asked) as { value: string }
    // Normalized already (Unit 8): the tool's JSON string arrives
    // parsed — accept the object or the raw string, never require one.
    const raw: unknown = JSON.parse(report.value) as unknown
    const inner = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      hits: Array<{ title: string; url: string }>; page: string
    }
    askOk = inner.hits.length >= 1
      && inner.hits.every((h) => typeof h.title === "string" && typeof h.url === "string")
      && typeof inner.page === "string" && inner.page.length > 200
  } catch {}
  results.push(yield* check("fire-tophits", askOk, detail(asked.slice(0, 120))))

  // Codemode path: first-party tools joinable in code.
  const joined = textOf(yield* rpc("tools/call", {
    name: "execute",
    arguments: {
      handle,
      code: `const r = await tools.search({ query: "workers", limit: 1 });
        return { n: r.length, first: r[0] ? r[0].title : null };`
    }
  }))
  let joinOk = false
  try {
    const report = JSON.parse(joined) as { value: string; toolCalls: number; untrusted: boolean }
    const inner = JSON.parse(report.value) as { n: number; first: string | null }
    joinOk = inner.n >= 1 && typeof inner.first === "string" && report.toolCalls >= 1 && report.untrusted === true
  } catch {}
  results.push(yield* check("execute-join", joinOk, detail(joined.slice(0, 120))))

  const closed = textOf(yield* rpc("tools/call", { name: "close", arguments: { handle } }))
  results.push(yield* check("call-close", closed.includes(handle), detail(closed.slice(0, 80))))

  return results.every(Boolean) ? 0 : 1
})

const exit = await Effect.runPromiseExit(main())
process.exit(exit._tag === "Success" ? exit.value : 1)
