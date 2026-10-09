// open: attach a page, record a session. Own browser by default
// (launched, killed by close); cdp borrows a tab of a foreign browser
// (navigates it — stated cost) and never kills it.
import { Effect, Schema } from "effect"
import { connect, discoverWs, listPageTools, sendBounded } from "../transport/client.ts"
import { Browser, openSession, type Opened } from "../sessions/sessions.ts"
import { SessionStore } from "../sessions/store.ts"
import { decodeArgs, toInputSchema, ToolFailed, type ToolCtx, type WebmcpTool } from "./definition.ts"

const Input = Schema.Struct({
  url: Schema.String,
  cdp: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number),
})

const borrow = Effect.fn("open.borrow")(function* (url: string, cdp: string, target: string | undefined) {
  const store = yield* SessionStore
  const wsUrl = yield* discoverWs(cdp, 5000)
  const conn = yield* connect(wsUrl)
  try {
    const targets = (yield* sendBounded(conn, "Target.getTargets", {}, 10000)) as {
      targetInfos: Array<{ targetId: string; type: string; url: string }>
    }
    const pages = targets.targetInfos.filter((t) => t.type === "page")
    const picked =
      target !== undefined ? pages.find((t) => t.targetId === target || t.url.includes(target)) : pages[0]
    if (picked === undefined) {
      return yield* Effect.fail(
        new ToolFailed({ tool: "open", detail: "foreign browser has no page tab to borrow." })
      )
    }
    const attached = (yield* sendBounded(conn, "Target.attachToTarget", { targetId: picked.targetId, flatten: true }, 10000)) as {
      sessionId: string
    }
    const tools = yield* listPageTools(conn, 10000, attached.sessionId)
    const handle = `s_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
    let origin: string
    try {
      origin = new URL(picked.url).origin
    } catch {
      origin = "null"
    }
    yield* store.save({
      handle,
      url: picked.url,
      origin,
      httpEndpoint: cdp,
      targetId: picked.targetId,
      ownBrowser: false,
      pid: 0,
      createdAt: Date.now(),
    })
    return { handle, url: picked.url, toolCount: tools.length } satisfies Opened
  } finally {
    yield* conn.close
  }
})

export const open: WebmcpTool = {
  name: "open",
  description:
    "Attach a web page and get a session handle. Own headless browser by default; pass cdp (DevTools http://host:port) to borrow a foreign tab instead (navigates it). toolCount is point-in-time — pages register as they load, so 0 means list again.",
  inputSchema: toInputSchema(Input),
  execute: (args: unknown, _ctx: ToolCtx) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(Input, "open")(args)
      if (input.cdp !== undefined) {
        const opened = yield* borrow(input.url, input.cdp, input.target)
        return { content: JSON.stringify({ ...opened }) }
      }
      const opened = yield* openSession(input.url)
      return { content: JSON.stringify({ ...opened }) }
    }),
}
