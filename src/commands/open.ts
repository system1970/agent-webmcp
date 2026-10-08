import { Console, Effect } from "effect"
import { attachPage, closePage, dial, navigate, probePageSupport, reattach } from "../transport/client.ts"
import { browserWs, pageTargets } from "../transport/devtools.ts"
import { TransportFailed, webmcpFloorFix } from "../transport/errors.ts"
import { fetchText } from "../transport/devtools.ts"
import { launchChromium } from "../transport/launch.ts"
import type { Launched } from "../transport/launch.ts"
import { newHandle, nowIso, saveSession } from "../sessions/store.ts"
import { UsageError, CliFailure, asCliFailure } from "./failure.ts"

// open [--cdp http://host:port] [--port N] <url>: attach a page and record
// a session handle. Own browser (default): launched detached, outlives this
// process, killed by `close`. Foreign browser (--cdp): we borrow the first
// page tab — create nothing, kill nothing.
export const open = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const opts = yield* parseOpenArgs(args)
    if (opts.cdp !== undefined) {
      yield* openForeign(opts.cdp, opts.target, opts.url, opts.json)
      return yield* Effect.void
    }
    const port = opts.port ?? (yield* pickPort())
    const browser = yield* launchChromium(port, true)
    yield* openOwn(browser, opts.url, opts.json).pipe(
      Effect.catch((f) => browser.close.pipe(
        Effect.ignore,
        Effect.andThen(() => Effect.fail(f))
      ))
    )
    return yield* Effect.void
  }).pipe(
    Effect.catchTag("TransportFailed", (f) => Effect.fail(asCliFailure(f)))
  )

interface OpenOpts {
  readonly cdp: string | undefined
  readonly target: string | undefined
  readonly port: number | undefined
  readonly url: string
  readonly json: boolean
}

const parseOpenArgs = Effect.fn("open.args")(function* (args: ReadonlyArray<string>) {
  let cdp: string | undefined
  let target: string | undefined
  let port: number | undefined
  let url: string | undefined
  let json = false
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
      if (!Number.isInteger(n) || n < 1024 || n > 65535) {
        return yield* Effect.fail(new UsageError({ message: `open: bad --port '${raw ?? "(missing)"}': want 1024-65535` }))
      }
      port = n
    } else if (arg === "--json") {
      json = true
    } else if (arg.startsWith("-")) {
      return yield* Effect.fail(new UsageError({ message: `open: unknown flag '${arg}'. Usage: open [--cdp URL [--target SUB]] [--port N] [--json] <url>` }))
    } else if (url === undefined) {
      url = arg
    } else {
      return yield* Effect.fail(new UsageError({ message: `open: unexpected argument '${arg}'. Usage: open [--cdp URL [--target SUB]] [--port N] [--json] <url>` }))
    }
  }
  if (url === undefined) {
    return yield* Effect.fail(new UsageError({ message: "open: missing <url>. Usage: open [--cdp URL [--target SUB]] [--port N] [--json] <url>" }))
  }
  if (!/^https?:\/\//.test(url)) {
    return yield* Effect.fail(new UsageError({ message: `open: refusing '${url}': want an http(s) URL` }))
  }
  if (target !== undefined && cdp === undefined) {
    return yield* Effect.fail(new UsageError({ message: "open: --target only makes sense with --cdp (own browsers start with one tab)" }))
  }
  const opts: OpenOpts = { cdp, target, port, url, json }
  return opts
})

// First free port from 9333 up: anything answering /json/version (even
// garbage — still somebody's port) means taken. Half-second budget per
// probe: twenty hung ports must not stall open for minutes.
const pickPort = Effect.fn("open.pickPort")(function* () {
  for (let port = 9333; port < 9353; port++) {
    const taken = yield* fetchText(`http://localhost:${port}/json/version`, 500).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false))
    )
    if (!taken) return port
  }
  return yield* Effect.fail(new CliFailure({
    message: "open: ports 9333-9352 all answer. Pass --port explicitly."
  }))
})

const persistAndPrint = Effect.fn("open.persist")(function* (
  record: { handle: string; browserHttp: string; targetId: string; url: string; ownBrowser: boolean; pid?: number; port?: number },
  createdAt: string,
  json: boolean
) {
  const full = { ...record, createdAt }
  // Persist before printing: a crash after print would orphan the page.
  yield* saveSession(full)
  if (json) {
    yield* Console.log(JSON.stringify(full, null, 2))
  } else {
    yield* Console.log(`${full.handle}  ${full.url}`)
  }
})

const openOwn = Effect.fn("open.own")(function* (browser: Launched, url: string, json: boolean) {
  const ws = yield* browserWs(browser.httpEndpoint)
  const conn = yield* dial(ws)
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      const page = yield* attachPage(conn)
      yield* navigate(conn, page.sessionId, url).pipe(
        Effect.catch((f) => closePage(conn, page.targetId).pipe(
          Effect.ignore,
          Effect.andThen(() => Effect.fail(f))
        ))
      )
      const supported = yield* probePageSupport(conn, page.sessionId)
      if (!supported) {
        yield* closePage(conn, page.targetId).pipe(Effect.ignore)
        return yield* Effect.fail(new TransportFailed({
          reason: "flags-missing",
          operation: "open",
          message: `${url} exposes no WebMCP surface`,
          fix: webmcpFloorFix
        }))
      }
      yield* persistAndPrint(
        {
          handle: yield* newHandle,
          browserHttp: browser.httpEndpoint,
          targetId: page.targetId,
          url,
          ownBrowser: true,
          pid: browser.pid,
          port: browser.port
        },
        yield* nowIso,
        json
      )
    }),
    conn.close
  )
})

const openForeign = Effect.fn("open.foreign")(function* (cdp: string, target: string | undefined, url: string, json: boolean) {
  const pages = yield* pageTargets(cdp)
  if (pages.length === 0) {
    return yield* Effect.fail(new TransportFailed({
      reason: "protocol",
      operation: "open",
      message: `${cdp} has no page targets to borrow`,
      fix: "open a tab in that browser first, or drop --cdp to launch our own."
    }))
  }
  const candidates = target === undefined
    ? [pages[0]]
    : pages.filter((p) => p.id.startsWith(target) || p.url.includes(target) || p.title.includes(target))
  if (candidates.length === 0) {
    return yield* Effect.fail(new TransportFailed({
      reason: "protocol",
      operation: "open",
      message: `no tab on ${cdp} matches '${target}'`,
      fix: `available tabs: ${pages.map((p) => `'${p.title || p.url}'`).join(", ")}`
    }))
  }
  if (candidates.length > 1) {
    return yield* Effect.fail(new TransportFailed({
      reason: "protocol",
      operation: "open",
      message: `'${target}' matches ${candidates.length} tabs (${candidates.map((p) => `'${p.title || p.url}'`).join(", ")}): refusing to guess which foreign tab to navigate`,
      fix: "pass a longer id prefix or a more specific URL/title substring via --target."
    }))
  }
  const borrowed = candidates[0]
  const ws = yield* browserWs(cdp)
  const conn = yield* dial(ws)
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      // Borrowed tab, stated cost: we NAVIGATE someone else's tab to our
      // URL (use --target to pick which). We never close it and never
      // kill its browser.
      const { sessionId } = yield* reattach(conn, borrowed.id)
      yield* navigate(conn, sessionId, url)
      const supported = yield* probePageSupport(conn, sessionId)
      if (!supported) {
        return yield* Effect.fail(new TransportFailed({
          reason: "flags-missing",
          operation: "open",
          message: `${url} exposes no WebMCP surface`,
          fix: webmcpFloorFix
        }))
      }
      yield* persistAndPrint(
        {
          handle: yield* newHandle,
          browserHttp: cdp,
          targetId: borrowed.id,
          url,
          ownBrowser: false
        },
        yield* nowIso,
        json
      )
    }),
    conn.close
  )
})
