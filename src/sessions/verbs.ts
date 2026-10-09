import { Effect } from "effect"
import {
  attachPage, closePage, dial, navigate, probePageSupport, reattach,
  sessionTools, snapshotTools, invokeTool
} from "../transport/client.ts"
import type { PageTool } from "../transport/client.ts"
import { browserWs, pageTargets } from "../transport/devtools.ts"
import { fetchText } from "../transport/devtools.ts"
import { TransportFailed, webmcpFloorFix } from "../transport/errors.ts"
import { launchChromium } from "../transport/launch.ts"
import type { Launched } from "../transport/launch.ts"
import { newHandle, nowIso, saveSession, listSessions, loadSession, removeSession } from "./store.ts"
import type { SessionRecord } from "./store.ts"
import { withSession } from "./connect.ts"
import { LIST_WINDOW_MS, INVOKE_TIMEOUT_MS, INVOKE_TIMEOUT_MAX_MS, PORT_MIN, PORT_MAX } from "../budgets.ts"
import { spillStats } from "../spill.ts"
import { CliFailure, asCliFailure } from "../failure.ts"
import { rmSync, readlinkSync } from "node:fs"

// Data verbs: the same operations the CLI verbs perform, minus printing.
// CLI commands parse argv and print; MCP tools pass JSON straight through.
// One implementation, two doors — same rule as the tool registry.

// First free port from 9333 up: anything answering /json/version (even
// garbage — still somebody's port) means taken. Half-second budget per
// probe: twenty hung ports must not stall open for minutes.
export const pickPort = Effect.fn("verbs.pickPort")(function* () {
  for (let port = 9333; port < 9353; port++) {
    const taken = yield* fetchText(`http://localhost:${port}/json/version`, 500).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false))
    )
    if (!taken) return port
  }
  return yield* Effect.fail(new CliFailure({
    message: "open: ports 9333-9352 all answer. Pass port explicitly."
  }))
})

export interface OpenInput {
  readonly url: string
  readonly cdp?: string
  readonly target?: string
  readonly port?: number
}

// Open returns the persisted record plus the tool count read at open
// time (one surface read, no event window). The count is point-in-time —
// pages register tools as they load — but it lets agents bail on
// tool-less pages before a list/describe spiral.
export interface OpenedSession {
  readonly record: SessionRecord
  readonly toolCount: number
}

export const openSession = Effect.fn("verbs.openSession")(function* (input: OpenInput) {
  if (!/^https?:\/\/[^/]+/.test(input.url)) {
    return yield* Effect.fail(new CliFailure({ message: `open: refusing '${input.url}': want an http(s) URL with a host` }))
  }
  // Centralized: --target only makes sense borrowing a foreign tab.
  // (The CLI parses the same rule for exit-2 UX; this is the enforced truth.)
  if (input.target !== undefined && input.cdp === undefined) {
    return yield* Effect.fail(new CliFailure({ message: "open: target only makes sense with cdp (own browsers start with one tab)" }))
  }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < PORT_MIN || input.port > PORT_MAX)) {
    return yield* Effect.fail(new CliFailure({ message: `open: bad port '${input.port}': want ${PORT_MIN}-${PORT_MAX}` }))
  }
  if (input.cdp !== undefined) {
    return yield* openForeign(input.cdp, input.target, input.url)
  }
  const port = input.port ?? (yield* pickPort())
  const browser = yield* launchChromium(port, true)
  return yield* openOwn(browser, input.url).pipe(
    Effect.catch((f) => browser.close.pipe(
      Effect.ignore,
      Effect.andThen(() => Effect.fail(f))
    ))
  )
})

const persistRecord = Effect.fn("verbs.persistRecord")(function* (
  record: Omit<SessionRecord, "handle" | "createdAt">
) {
  const full: SessionRecord = { ...record, handle: yield* newHandle, createdAt: yield* nowIso }
  // Persist before returning: a crash after print would orphan the page.
  yield* saveSession(full)
  return full
})

const openOwn = Effect.fn("verbs.openOwn")(function* (browser: Launched, url: string) {
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
      // Count at open: one surface read (~100ms, no event window) so
      // agents bail on tool-less pages before a list/describe spiral.
      // Snapshot FAILURE (broken surface, e.g. polyfilled getTools)
      // fails the open loud here instead of mid-loop — a snapshot that
      // succeeds empty ([]) still opens fine with toolCount 0.
      const tools = yield* snapshotTools(conn, page.sessionId)
      return yield* persistRecord({
        browserHttp: browser.httpEndpoint,
        targetId: page.targetId,
        url,
        ownBrowser: true,
        pid: browser.pid,
        port: browser.port
      }).pipe(
        Effect.map((record): OpenedSession => ({ record, toolCount: tools.length }))
      )
    }),
    conn.close
  )
})

const openForeign = Effect.fn("verbs.openForeign")(function* (cdp: string, target: string | undefined, url: string) {
  const pages = yield* pageTargets(cdp)
  if (pages.length === 0) {
    return yield* Effect.fail(new TransportFailed({
      reason: "protocol",
      operation: "open",
      message: `${cdp} has no page targets to borrow`,
      fix: "open a tab in that browser first, or drop cdp to launch our own."
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
      fix: "pass a longer id prefix or a more specific URL/title substring as target."
    }))
  }
  const borrowed = candidates[0]
  const ws = yield* browserWs(cdp)
  const conn = yield* dial(ws)
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      // Borrowed tab, stated cost: we NAVIGATE someone else's tab to our
      // URL. We never close it and never kill its browser.
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
      // Same count-at-open contract as own browsers (comment above).
      const tools = yield* snapshotTools(conn, sessionId)
      return yield* persistRecord({
        browserHttp: cdp,
        targetId: borrowed.id,
        url,
        ownBrowser: false
      }).pipe(
        Effect.map((record): OpenedSession => ({ record, toolCount: tools.length }))
      )
    }),
    conn.close
  )
})

export interface SessionCatalog {
  readonly handle: string
  readonly url: string
  readonly tools: ReadonlyArray<PageTool>
}

export const listSessionTools = Effect.fn("verbs.listSessionTools")(function* (handle: string) {
  return yield* withSession(handle, (conn, record, sessionId) =>
    Effect.gen(function* () {
      const tools = yield* sessionTools(conn, sessionId, LIST_WINDOW_MS)
      const catalog: SessionCatalog = { handle, url: record.url, tools }
      return catalog
    }))
})

export interface CloseSummary {
  readonly closed: Array<string>
  readonly failed: Array<{ handle: string; message: string }>
}

export const closeSession = Effect.fn("verbs.closeSession")(function* (handle: string) {
  const record = yield* loadSession(handle)
  // Dead browsers are not errors — but only dead ones. Anything else
  // (protocol, timeout) fails loud AFTER local cleanup, so a wedged
  // browser never holds the record hostage while still reporting truth.
  yield* browserWs(record.browserHttp).pipe(
    Effect.flatMap((ws) => Effect.gen(function* () {
      const conn = yield* dial(ws)
      yield* Effect.ensuring(closePage(conn, record.targetId), conn.close)
    })),
    Effect.catchTag("TransportFailed", (f) =>
      f.reason === "no-browser" || f.reason === "navigated"
        ? Effect.void
        : Effect.fail(f))
  ).pipe(
    Effect.catch((f) => cleanupLocal(record).pipe(
      Effect.andThen(() => removeSession(handle)),
      Effect.andThen(() => Effect.fail(f))
    )),
    // Middle lane: TransportFailed leaves here as a clean CliFailure.
    // Defects still die loud.
    Effect.catchTag("TransportFailed", (f) => Effect.fail(asCliFailure(f)))
  )
  yield* cleanupLocal(record)
  yield* removeSession(handle)
  return handle
})

export const closeAllSessions = Effect.fn("verbs.closeAllSessions")(function* () {
  const sessions = yield* listSessions()
  // Fold, don't accumulate: each record maps to its outcome, then the
  // outcomes partition into the summary. Sequential: kills are independent
  // but ordered output reads better in `close --all` logs.
  const outcomes = yield* Effect.forEach(sessions, (record) =>
    closeSession(record.handle).pipe(
      // Operational failures only (CliFailure — closeSession already maps
      // TransportFailed at its boundary): a defect means the runtime
      // itself is wedged — let it die with a dump, never convert.
      Effect.as({ handle: record.handle, ok: true as const }),
      Effect.catchTag("CliFailure", (f) =>
        Effect.succeed({ handle: record.handle, ok: false as const, message: f.message }))
    )
  )
  type Failed = { handle: string; ok: false; message: string }
  const summary: CloseSummary = {
    closed: outcomes.filter((o) => o.ok).map((o) => o.handle),
    failed: outcomes.filter((o): o is Failed => !o.ok).map((o) => ({ handle: o.handle, message: o.message }))
  }
  return summary
})

const cleanupLocal = Effect.fn("verbs.cleanupLocal")(function* (record: SessionRecord) {
  if (!record.ownBrowser) return
  const pid = record.pid
  // Never kill a number from disk unverified: confirm /proc/<pid> is
  // OUR chromium before SIGKILL. argv is faker-friendly, so the check is
  // the exe symlink (the running binary, unfakeable) plus our profile-dir
  // marker in argv. A planted record otherwise turns close into
  // kill-an-arbitrary-pid.
  if (pid !== undefined && record.port !== undefined) {
    const marker = `agent-webmcp-chrome-${record.port}`
    const verified = yield* Effect.tryPromise(async () => {
      const exe = readlinkSync(`/proc/${pid}/exe`)
      const cmd = await Bun.file(`/proc/${pid}/cmdline`).text()
      return exe.includes("chromium") && cmd.includes(marker)
    }).pipe(Effect.catch(() => Effect.succeed(false)))
    if (verified) {
      yield* Effect.sync(() => {
        try {
          process.kill(pid, "SIGKILL")
        } catch {}
      })
    }
    const dir = `/tmp/opencode/agent-webmcp-chrome-${record.port}`
    yield* Effect.sync(() => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {}
    })
  }
})
export interface PageCallResult {
  readonly tool: string
  readonly status: "Completed" | "Canceled" | "Error"
  readonly output: unknown
  readonly errorText: string | undefined
  readonly origin: string
  readonly untrusted: true
}

// Output normalization (L6 in docs/review-learnings.md): page outputs
// arrive as MCP envelopes ({content, structuredContent}); agents consume
// one shape — structuredContent when present, else the try-parsed first
// text part, else raw text. Scalars (fixture strings included) pass
// through untouched. Pure: unit-tested directly, no browser.
export const normalizeOutput = (output: unknown): unknown => {
  if (typeof output !== "object" || output === null) return output
  const env = output as { structuredContent?: unknown; content?: unknown }
  if (env.structuredContent !== undefined) return env.structuredContent
  const parts = Array.isArray(env.content) ? env.content : []
  const text = (parts[0] as { text?: unknown } | undefined)?.text
  if (typeof text !== "string") return output
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export const invokeSessionTool = Effect.fn("verbs.invokeSessionTool")(function* (
  handle: string,
  name: string,
  input: Record<string, unknown>,
  timeoutMs = INVOKE_TIMEOUT_MS
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > INVOKE_TIMEOUT_MAX_MS) {
    return yield* Effect.fail(new CliFailure({ message: `bad timeoutMs '${timeoutMs}': want 1-${INVOKE_TIMEOUT_MAX_MS} ms` }))
  }
  return yield* withSession(handle, (conn, record, sessionId) =>
    Effect.gen(function* () {
      const tools = yield* sessionTools(conn, sessionId, LIST_WINDOW_MS)
      const matches = tools.filter((t) => t.name === name)
      if (matches.length === 0) {
        return yield* Effect.fail(new CliFailure({
          message: `unknown tool '${name}' on ${handle}` +
            (tools.length > 0 ? ` (available: ${tools.map((t) => t.name).join(", ")})` : " (the page publishes nothing right now)") +
            ` :: run \`list ${handle}\` to refresh (tools register per page state).`
        }))
      }
      if (matches.length > 1) {
        return yield* Effect.fail(new CliFailure({
          message: `ambiguous tool '${name}' on ${handle}: registered in ${matches.length} frames (${matches.map((t) => t.frameId.slice(0, 8)).join(", ")}).`
        }))
      }
      const target = matches[0]
      const result = yield* invokeTool(
        conn,
        sessionId,
        { frameId: target.frameId, toolName: name, args: input },
        timeoutMs
      )
      const out: PageCallResult = {
        tool: name,
        status: result.status,
        output: normalizeOutput(result.output),
        errorText: result.errorText,
        origin: record.url,
        untrusted: true as const
      }
      return out
    }))
})

export interface StatusReport {
  readonly sessions: Array<{ handle: string; url: string }>
  readonly spill: { files: number; bytes: number }
}

// Read-only observability: store records + spill dir stats. Records only,
// never dials — a status check that woke browsers would be a side effect.
export const statusSessions = Effect.fn("verbs.status")(function* () {
  const records = yield* listSessions()
  const stats = yield* Effect.try(() => spillStats()).pipe(
    Effect.mapError((cause) => new CliFailure({
      message: `status: cannot stat spill dir: ${cause instanceof Error ? cause.message : String(cause)}`
    }))
  )
  const report: StatusReport = {
    sessions: records.map((r) => ({ handle: r.handle, url: r.url })),
    spill: stats
  }
  return report
})
