// Unit 8 eval: one cross-page join against REAL sites over stdio, no
// model. Usage: `bun run eval:real`. Manual (needs network + chromium).
// open store + library (open_ms each, toolCount each) -> one execute
// block joins both (shop cart + library gems, origins[] + perSession) ->
// close both. Asserts shapes and counts, never exact page values (vendor
// pages change; decisions.md forbids pin-exact). If a vendor page moves,
// the failing call names itself in check detail — that failure is signal.
//
// Sites (verified 2026-10-09): kylerisley.com store (search_products,
// get_product, add_to_cart, view_cart), vibing.inc library
// (library_search). The stdio client below is the fourth copy of the
// JSON-RPC pump (G15 tracks extracting scripts/mcp-harness.ts).
import { Console, Effect } from "effect"

const STORE = "https://kylerisley.com/tools/webmcp-playground/"
const LIB = "https://vibing.inc/webmcp"

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
  // Fire-and-forget pump by design: appends to locals the fiber reads
  // after awaits (same shape as eval-mcp/eval-xpage).
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
      }, 60000)
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
    clientInfo: { name: "eval-real", version: "0.0.0" }
  })) as { result?: { serverInfo?: { name?: string } } } | null
  results.push(yield* check("initialize", init?.result?.serverInfo?.name === "agent-webmcp", detail(JSON.stringify(init?.result?.serverInfo ?? null))))

  // Open both real pages, timed. The count is point-in-time: 0
  // proceeds to the windowed list settle below — only malformed
  // handles bail here.
  const openStartS = Date.now()
  const openS = textOf(yield* rpc("tools/call", { name: "open", arguments: { url: STORE } }))
  const openMsS = Date.now() - openStartS
  const openStartL = Date.now()
  const openL = textOf(yield* rpc("tools/call", { name: "open", arguments: { url: LIB } }))
  const openMsL = Date.now() - openStartL
  yield* Console.log(`open_ms: store=${openMsS} library=${openMsL} (report-only)`)
  let hS = ""
  let hL = ""
  let nS = -1
  let nL = -1
  try {
    const s = JSON.parse(openS) as { handle: string; toolCount: number }
    const l = JSON.parse(openL) as { handle: string; toolCount: number }
    hS = s.handle
    hL = l.handle
    nS = s.toolCount
    nL = l.toolCount
  } catch {}
  const handlesOk = /^s_[a-z0-9]+$/.test(hS) && /^s_[a-z0-9]+$/.test(hL) && hS !== hL
  results.push(yield* check("open-both", handlesOk, detail(`${hS} ${hL}`)))
  // Contract shape only: the count is point-in-time (snapshot, no
  // window) — slow-registering pages read 0 here and settle later.
  results.push(yield* check(
    "open-toolcounts",
    Number.isInteger(nS) && nS >= 0 && Number.isInteger(nL) && nL >= 0,
    detail(`store=${nS} library=${nL}`)
  ))
  if (!handlesOk) {
    for (const handle of [hS, hL]) {
      if (/^s_[a-z0-9]+$/.test(handle)) {
        yield* rpc("tools/call", { name: "close", arguments: { handle } }).pipe(Effect.ignore)
      }
    }
    return 1
  }

  // Settled catalogs: the windowed list (snapshot + event window)
  // catches late registrants — both real pages must settle non-empty.
  const listS = textOf(yield* rpc("tools/call", { name: "list", arguments: { handle: hS } }))
  const listL = textOf(yield* rpc("tools/call", { name: "list", arguments: { handle: hL } }))
  let settledOk = false
  try {
    const s = JSON.parse(listS) as { tools: Array<unknown> }
    const l = JSON.parse(listL) as { tools: Array<unknown> }
    settledOk = s.tools.length >= 1 && l.tools.length >= 1
  } catch {}
  results.push(yield* check("settled-catalogs", settledOk, detail(`store/list library/list settled non-empty`)))

  // One block, two sessions: shop the kettle, add one to cart, pull
  // library gems. No checkout (demo; nobody pays). Values arrive
  // NORMALIZED (Unit 8 item 1) — consumed directly, no envelope
  // unwrapping, no pluck shims: this block is the L6 consumption test.
  const joined = textOf(yield* rpc("tools/call", {
    name: "execute",
    arguments: {
      sessions: { store: hS, library: hL },
      code: `const found = await sesh.store.tools.search_products({ query: "kettle" });
        const kettle = (found.products || [])[0];
        const added = await sesh.store.tools.add_to_cart({ id: kettle.id, quantity: 1 });
        const cart = await sesh.store.tools.view_cart({});
        const gems = await sesh.library.tools.library_search({ query: "webgpu", limit: 3 });
        return { kettleId: kettle.id, cartCount: cart.itemCount, gemsReturned: gems.returned };`
    }
  }))
  let joinOk = false
  let toolCalls = -1
  try {
    const report = JSON.parse(joined) as {
      value: string; toolCalls: number; perSession: Record<string, number>;
      origins: Array<string>; untrusted: boolean
    }
    const inner = JSON.parse(report.value) as { kettleId: string; cartCount: number; gemsReturned: number }
    toolCalls = report.toolCalls
    // Shapes and counts only: kettle id non-empty, one cart line, at
    // least one gem, both origins present, both aliases counted.
    joinOk = typeof inner.kettleId === "string" && inner.kettleId !== ""
      && inner.cartCount >= 1 && inner.gemsReturned >= 1
      && report.origins.length === 2
      && (report.perSession.store ?? 0) >= 3 && (report.perSession.library ?? 0) >= 1
      && report.untrusted === true
  } catch {}
  results.push(yield* check("xpage-join", joinOk, detail(`${joined.slice(0, 120)} toolCalls=${toolCalls}`)))
  yield* Console.log(`toolCalls: ${toolCalls} (one block; open->list->describe->act would cost 4+ turns)`)

  const closeS = textOf(yield* rpc("tools/call", { name: "close", arguments: { handle: hS } }))
  const closeL = textOf(yield* rpc("tools/call", { name: "close", arguments: { handle: hL } }))
  results.push(yield* check("close-both", closeS.includes(hS) && closeL.includes(hL), detail(`${closeS.slice(0, 40)} ${closeL.slice(0, 40)}`)))

  server.stop()
  return results.every(Boolean) ? 0 : 1
})

const exit = await Effect.runPromiseExit(main())
process.exit(exit._tag === "Success" ? exit.value : 1)
