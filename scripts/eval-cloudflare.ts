// Unit 12 eval: agent-driven authoring against Cloudflare docs over
// stdio, no model. Usage: `bun run eval:cloudflare`. Manual (needs
// network + chromium).
// open (toolCount 0: their tools live on navigator, not document) ->
// inject navigator->document bridge -> re-dispatch astro:page-load ->
// list shows THEIR first-party tools (search, list-directories) ->
// invoke list-directories (shape) -> invoke search (live AI backend,
// shape-only) -> inject custom topHits (search + page fetch, a tool
// their site never published) -> invoke it -> execute join through
// code (codemode path) -> close.
//
// Why this matters: the page authors first-party tools but gates them
// on navigator.modelContext, which flagless browsers lack. Our flagged
// headless HAS the real document.modelContext — the bridge is 10 lines
// and everything downstream is native (CDP invoke, their backend).
// Values assert shapes/counts only (vendor backend varies); decisions.md
// forbids pin-exact.
import { Console, Duration, Effect } from "effect"

const DOCS = "https://developers.cloudflare.com/"

// Bridge: navigator.modelContext backed by the REAL document surface.
// Their registrar (astro:page-load) then registers natively — engine
// list sees them, CDP invoke drives them, their backend executes.
const BRIDGE = `(() => {
  if (navigator.modelContext) return "native";
  const real = document.modelContext;
  Object.defineProperty(navigator, "modelContext", { value: {
    registerTool: (t) => real.registerTool(t),
    getTools: () => real.getTools(),
    executeTool: (n, a) => real.executeTool(n, a)
  }, configurable: true });
  document.dispatchEvent(new Event("astro:page-load"));
  return "bridged+redispatched";
})()`

// Custom authoring on their backend: topHits composes THEIR search API
// (same fetch their native tool uses) with a page fetch — a custom tool
// their site never published. (Their chat path, .../ai-search/ai-search,
// 403s preflight for everyone including their own UI — fenced
// server-side, not authorable. Verified 2026-10-09; cut, not chased.)
const TOPHITS = `navigator.modelContext.registerTool({
  name: "topHits",
  description: "Search Cloudflare docs and return the top hits plus the first result page as text.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  annotations: {},
  execute: async (args) => {
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
  }
}); "topHits-registered"`

interface McpServer {
  readonly call: (method: string, params: unknown) => Promise<unknown>
  readonly stop: () => void
  readonly errTail: Array<string>
}

const startServer = (): McpServer => {
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
  // Fire-and-forget pump by design (eval-mcp shape, G15 tracks the
  // shared-harness extraction).
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
      }, 90000)
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  return {
    call,
    stop: () => {
      try {
        proc.kill("SIGKILL")
      } catch {}
    },
    errTail
  }
}

const check = Effect.fn("eval.check")(function* (name: string, cond: boolean, detail: string) {
  yield* Console.log(`${cond ? "PASS" : "FAIL"} ${name} :: ${detail.slice(0, 120)}`)
  return cond
})

const textOf = (response: unknown): string => {
  const content = (response as { result?: { content?: Array<{ text?: string }> } }).result?.content
  return content?.map((c) => c.text ?? "").join("\n") ?? ""
}

const main = Effect.fn("eval.main")(function* () {
  const results: Array<boolean> = []
  const server = yield* Effect.sync(() => startServer())
  return yield* Effect.ensuring(runChecks(server, results), Effect.sync(() => server.stop()))
})

const runChecks = Effect.fn("eval.checks")(function* (
  server: McpServer,
  results: Array<boolean>
) {
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

  // Bridge + re-dispatch: their registrar runs natively from here.
  const bridged = textOf(yield* rpc("tools/call", {
    name: "inject",
    arguments: { handle, code: BRIDGE }
  }))
  let bridgeOk = false
  try {
    bridgeOk = (JSON.parse(bridged) as { value: string }).value === "bridged+redispatched"
  } catch {}
  results.push(yield* check("inject-bridge", bridgeOk, detail(bridged.slice(0, 80))))

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
  const dirs = textOf(yield* rpc("tools/call", {
    name: "invoke",
    arguments: { handle, tool: "list-directories", args: {} }
  }))
  let dirsOk = false
  try {
    const out = JSON.parse(dirs) as { output: Array<{ name: string; url: string }> }
    dirsOk = Array.isArray(out.output) && out.output.length > 10
      && out.output.every((d) => typeof d.name === "string" && typeof d.url === "string")
  } catch {}
  results.push(yield* check("invoke-directories", dirsOk, detail(dirs.slice(0, 120))))

  // Their AI backend, live: chunks with title + url (values vary — shapes only).
  const searched = textOf(yield* rpc("tools/call", {
    name: "invoke",
    arguments: { handle, tool: "search", args: { query: "workers KV read", limit: 3 } }
  }))
  let searchOk = false
  try {
    const out = JSON.parse(searched) as { output: Array<{ title: string; url: string }> }
    searchOk = Array.isArray(out.output) && out.output.length >= 1
      && out.output.every((c) => typeof c.title === "string" && typeof c.url === "string")
  } catch {}
  results.push(yield* check("invoke-cf-search", searchOk, detail(searched.slice(0, 120))))

  // Custom authoring on their backend: topHits wires search + page
  // fetch into one tool their site never published.
  const crafted = textOf(yield* rpc("tools/call", {
    name: "inject",
    arguments: { handle, code: TOPHITS }
  }))
  let craftOk = false
  try {
    craftOk = (JSON.parse(crafted) as { value: string }).value === "topHits-registered"
  } catch {}
  results.push(yield* check("inject-tophits", craftOk, detail(crafted.slice(0, 80))))
  const asked = textOf(yield* rpc("tools/call", {
    name: "invoke",
    arguments: { handle, tool: "topHits", args: { query: "workers KV read" } }
  }))
  let askOk = false
  try {
    const out = JSON.parse(asked) as { output: unknown }
    // Normalized already (Unit 8): the tool's JSON string arrives
    // parsed — accept the object or the raw string, never require one.
    const inner = (typeof out.output === "string" ? JSON.parse(out.output) : out.output) as {
      hits: Array<{ title: string; url: string }>; page: string
    }
    askOk = inner.hits.length >= 1
      && inner.hits.every((h) => typeof h.title === "string" && typeof h.url === "string")
      && typeof inner.page === "string" && inner.page.length > 200
  } catch {}
  results.push(yield* check("invoke-tophits", askOk, detail(asked.slice(0, 120))))

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
