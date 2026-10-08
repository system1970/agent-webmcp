// Unit 2 eval: sessions + verbs across separate CLI processes.
// Usage: `bun run eval:sessions`. Manual (needs network + chromium).
// Proves the core claim: handles persist on disk, every verb reattaches.
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

  // 2. list sees searchFlights through a fresh reattach.
  const listed = yield* cli("list", handle)
  results.push(yield* check("list", listed.code === 0 && listed.out.includes("searchFlights"), listed.out.split("\n")[0] ?? ""))

  // 3. invoke round-trips page data with the untrusted banner.
  const invoked = yield* cli("invoke", handle, "searchFlights", `{"origin":"SFO","destination":"JFK"}`)
  results.push(yield* check(
    "invoke",
    invoked.code === 0 && invoked.out.includes("status: Completed") && invoked.out.includes("untrusted data"),
    invoked.out.split("\n")[0] ?? ""
  ))

  // 4. Unknown tool names the available ones (exit 1, clean line).
  const missed = yield* cli("invoke", handle, "nope", "{}")
  results.push(yield* check(
    "unknown-tool",
    missed.code === 1 && missed.out.includes("unknown tool 'nope'"),
    missed.out.slice(0, 100)
  ))

  // 5. Tool-less page: with Testing flags the surface exists everywhere,
  // so open succeeds and list reports empty (a fact, exit 0).
  const openedPlain = yield* cli("open", "--json", "https://example.com")
  let plainOk = false
  if (openedPlain.code === 0) {
    try {
      const plainHandle = (JSON.parse(openedPlain.out) as { handle: string }).handle
      const plainList = yield* cli("list", plainHandle)
      plainOk = plainList.code === 0 && plainList.out.includes("publishes nothing")
      yield* cli("close", plainHandle)
    } catch {}
  }
  results.push(yield* check("tool-less-empty", plainOk, openedPlain.out.slice(0, 80)))

  // 6. close drops the record; the handle is unknown afterwards.
  const closed = yield* cli("close", handle)
  const afterClose = yield* cli("list", handle)
  results.push(yield* check(
    "close",
    closed.code === 0 && afterClose.code === 1 && afterClose.out.includes(`unknown session '${handle}'`),
    afterClose.out.slice(0, 100)
  ))

  // 7. Usage errors exit 2.
  const usage = yield* cli("open")
  results.push(yield* check("usage-2", usage.code === 2 && usage.out.includes("usage error"), usage.out.slice(0, 80)))

  // 8. CLI search finds engine verbs (no browser needed): row shape.
  const found = yield* cli("search", "session", "handle")
  results.push(yield* check("cli-search", found.code === 0 && found.out.includes("open —"), found.out.split("\n")[0] ?? ""))

  // 9. CLI execute batches engine-local calls (no browser needed).
  const batched = yield* cli("execute", "--json", `[{"tool":"search","args":{"query":"close","limit":1}}]`)
  let batchOk = false
  try {
    const report = JSON.parse(batched.out) as { results: Array<{ tool: string; ok: boolean }> }
    batchOk = batched.code === 0 && report.results.length === 1 && report.results[0].ok === true
  } catch {}
  results.push(yield* check("cli-execute", batchOk, batched.out.slice(0, 80)))

  // 10. Foreign borrow: second browser, --target picks the tab, close
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
        yield* cli("close", fHandle)
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
