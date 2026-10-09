// Unit 2 eval: sessions + verbs across separate CLI processes.
// Usage: `bun run eval:sessions`. Manual (needs network + chromium).
// Proves the core claim: handles persist on disk, every verb reattaches.
// CLI door covers lifecycle only (open/list/close/register); composition rides MCP.
import { Console, Effect } from "effect"
import { launchChromium } from "../src/transport/launch.ts"

const DEMO = "https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/"

interface Run {
  readonly code: number
  readonly out: string
}

const cli = (...args: Array<string>): Effect.Effect<Run> =>
  Effect.sync(() => {
    const proc = Bun.spawnSync(["bun", "./src/main.ts", ...args], {
      stdout: "pipe",
      stderr: "pipe"
    })
    const text = (buf: Uint8Array | null): string => new TextDecoder().decode(buf ?? new Uint8Array())
    return { code: proc.exitCode ?? 1, out: (text(proc.stdout) + text(proc.stderr)).trim() }
  })

const check = Effect.fn("eval.check")(function* (name: string, cond: boolean, detail: string) {
  yield* Console.log(`${cond ? "PASS" : "FAIL"} ${name} :: ${detail.split("\n")[0]}`)
  return cond
})

const main = Effect.fn("eval.main")(function* () {
  const results: Array<boolean> = []

  // 1. open prints a handle (separate process from everything below).
  const opened = yield* cli("open", "--json", DEMO)
  const handle = (() => {
    try {
      return (JSON.parse(opened.out) as { handle: string }).handle
    } catch {
      return ""
    }
  })()
  results.push(yield* check("open", opened.code === 0 && handle.startsWith("s_"), opened.out.slice(0, 80)))
  if (handle === "") return 1

  // 2. list sees searchFlights through a fresh reattach (piped
  // output defaults to JSON — this asserts the machine door). Open
  // races SPA registration: poll until present (bounded), never
  // blind-sleep.
  const pollFor = Effect.fn("eval.pollFor")(function* (name: string) {
    for (let i = 0; i < 6; i++) {
      const seen = yield* cli("list", handle)
      try {
        const catalog = JSON.parse(seen.out) as { tools: Array<{ name: string }> }
        if (seen.code === 0 && catalog.tools.some((t) => t.name === name)) return seen
      } catch {}
      yield* Effect.sleep("2 seconds")
    }
    return yield* cli("list", handle)
  })
  const listed = yield* pollFor("searchFlights")
  let listOk = false
  try {
    const catalog = JSON.parse(listed.out) as { tools: Array<{ name: string }> }
    listOk = listed.code === 0 && catalog.tools.some((t) => t.name === "searchFlights")
  } catch {}
  results.push(yield* check("list", listOk, listed.out.split("\n")[0] ?? ""))

  // 3. Tool-less page: with Testing flags the surface exists everywhere,
  // so open succeeds and list reports empty (a fact, exit 0).
  const openedPlain = yield* cli("open", "--json", "https://example.com")
  let plainOk = false
  if (openedPlain.code === 0) {
    try {
      const plainHandle = (JSON.parse(openedPlain.out) as { handle: string }).handle
      const plainList = yield* cli("list", plainHandle)
      const catalog = JSON.parse(plainList.out) as { tools: Array<unknown> }
      plainOk = plainList.code === 0 && Array.isArray(catalog.tools) && catalog.tools.length === 0
      yield* cli("close", "--yes", plainHandle)
    } catch {}
  }
  results.push(yield* check("tool-less-empty", plainOk, openedPlain.out.slice(0, 80)))

  // 4. close drops the record; the handle is unknown afterwards.
  // Mutations confirm deliberately (--yes).
  const closed = yield* cli("close", "--yes", handle)
  const afterClose = yield* cli("list", handle)
  results.push(yield* check(
    "close",
    closed.code === 0 && afterClose.code === 1 && afterClose.out.includes(`unknown session '${handle}'`),
    afterClose.out.slice(0, 100)
  ))

  // 5. Usage errors exit 2.
  const usage = yield* cli("open")
  results.push(yield* check("usage-2", usage.code === 2 && usage.out.includes("usage error"), usage.out.slice(0, 80)))

  // 6. Foreign borrow: second browser, --target picks the tab, close
  // leaves the foreign browser alive (never ours to kill).
  const foreign = yield* launchChromium(9455)
  yield* Effect.ensuring(
    Effect.gen(function* () {
      const fOpen = yield* cli("open", "--json", "--cdp", foreign.httpEndpoint, "--target", "blank", DEMO)
      const fHandle = (() => {
        try {
          return (JSON.parse(fOpen.out) as { handle: string }).handle
        } catch {
          return ""
        }
      })()
      let listedOk = false
      if (fHandle !== "") {
        listedOk = (yield* cli("list", fHandle)).out.includes("searchFlights")
        yield* cli("close", "--yes", fHandle)
      }
      results.push(yield* check("foreign-target", fOpen.code === 0 && listedOk, fOpen.out.slice(0, 80)))
      // Foreign browser must still answer after our close.
      const alive = yield* Effect.tryPromise(
        () => fetch(`${foreign.httpEndpoint}/json/version`).then((r) => r.ok)
      ).pipe(Effect.catch(() => Effect.succeed(false)))
      results.push(yield* check("foreign-alive", alive, "foreign browser survives close"))
    }),
    foreign.close
  )

  for (const [i, ok] of results.entries()) {
    if (!ok) {
      yield* Console.log(`eval ${i + 1} FAILED`)
    }
  }
  return results.every(Boolean) ? 0 : 1
})

const exit = await Effect.runPromiseExit(main())
process.exit(exit._tag === "Success" ? exit.value : 1)
