import { Console, Effect } from "effect"
import { openSession } from "../sessions/verbs.ts"
import type { OpenInput } from "../sessions/verbs.ts"
import { UsageError, CliFailure, asCommandFailure, resolveJson } from "../failure.ts"
import { PORT_MIN, PORT_MAX } from "../budgets.ts"

// open [--cdp http://host:port] [--port N] [--json|--plain] <url>: attach a page and record
// a session handle. Thin argv shell over verbs.openSession (shared with
// the MCP `open` tool); printing is the only CLI-specific work here.
export const open = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const opts = yield* parseOpenArgs(args)
    const input: OpenInput = { url: opts.url, cdp: opts.cdp, target: opts.target, port: opts.port }
    const opened = yield* openSession(input)
    const record = opened.record
    if (resolveJson({ json: opts.json, plain: opts.plain, isTTY: process.stdout.isTTY })) {
      yield* Console.log(JSON.stringify({ ...record, toolCount: opened.toolCount }, null, 2))
    } else {
      yield* Console.log(`${record.handle}  ${record.url}  (${opened.toolCount} tools)`)
    }
    return yield* Effect.void
  }).pipe(
    Effect.catchTag("TransportFailed", (f) => Effect.fail(asCommandFailure(f)))
  )

interface OpenOpts {
  readonly cdp: string | undefined
  readonly target: string | undefined
  readonly port: number | undefined
  readonly url: string
  readonly json: boolean
  readonly plain: boolean
}

const parseOpenArgs = Effect.fn("open.args")(function* (args: ReadonlyArray<string>) {
  let cdp: string | undefined
  let target: string | undefined
  let port: number | undefined
  let url: string | undefined
  let json = false
  let plain = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--cdp") {
      cdp = args[++i]
      if (cdp === undefined || !/^https?:\/\//.test(cdp)) {
        return yield* Effect.fail(new UsageError({ message: "open: --cdp needs an endpoint http://host:port (DevTools HTTP, not ws)" }))
      }
    } else if (arg === "--target") {
      target = args[++i]
      if (target === undefined) {
        return yield* Effect.fail(new UsageError({ message: "open: --target needs a substring to match tab URL/title, or a target id prefix" }))
      }
    } else if (arg === "--port") {
      const raw = args[++i]
      const n = Number(raw)
      if (!Number.isInteger(n) || n < PORT_MIN || n > PORT_MAX) {
        return yield* Effect.fail(new UsageError({ message: `open: bad --port '${raw ?? "(missing)"}': want ${PORT_MIN}-${PORT_MAX}` }))
      }
      port = n
    } else if (arg === "--json") {
      json = true
    } else if (arg === "--plain") {
      plain = true
    } else if (arg.startsWith("-")) {
      return yield* Effect.fail(new UsageError({ message: `open: unknown flag '${arg}'. Usage: open [--cdp URL [--target SUB]] [--port N] [--json|--plain] <url>` }))
    } else if (url === undefined) {
      url = arg
    } else {
      return yield* Effect.fail(new UsageError({ message: `open: unexpected argument '${arg}'. Usage: open [--cdp URL [--target SUB]] [--port N] [--json|--plain] <url>` }))
    }
  }
  if (url === undefined) {
    return yield* Effect.fail(new UsageError({ message: "open: missing <url>. Usage: open [--cdp URL [--target SUB]] [--port N] [--json|--plain] <url>" }))
  }
  if (!/^https?:\/\/[^/]+/.test(url)) {
    return yield* Effect.fail(new UsageError({ message: `open: refusing '${url}': want an http(s) URL with a host` }))
  }
  if (target !== undefined && cdp === undefined) {
    return yield* Effect.fail(new UsageError({ message: "open: --target only makes sense with --cdp (own browsers start with one tab)" }))
  }
  const opts: OpenOpts = { cdp, target, port, url, json, plain }
  return opts
})
