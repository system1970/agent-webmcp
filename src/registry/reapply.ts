// Re-apply: file tools back onto a freshly attached page. Best-effort
// by contract — it NEVER fails an open (a dead tool must not veto a
// session). Per tool: skip-if-live (native OR authored — two sessions
// sharing one borrowed tab must not double-register), else register +
// PRESENCE-CHECK (never fixture-invoke: fixtures mutate; proof happened
// at birth). Refused/absent → quarantine (reported, files kept).
import { Effect, Result } from "effect"
import { evaluateJson, listPageTools, type CdpConnection, type PageTool } from "../transport/client.ts"
import { listOriginTools, loadTool, markVerified } from "./registry.ts"
import { parseRegisterReply, registerSnippet } from "./snippet.ts"

export interface ReapplySkipped {
  readonly name: string
  readonly reason: string
}

export interface Reapplied {
  readonly reapplied: ReadonlyArray<string>
  readonly skipped: ReadonlyArray<ReapplySkipped>
}

export const reapplyOrigin = (options: {
  conn: CdpConnection
  sessionId: string
  origin: string
  root: string | undefined
  timeoutMs: number
}): Effect.Effect<Reapplied, never> =>
  Effect.gen(function* () {
    const { conn, sessionId, origin, root, timeoutMs } = options
    const done: Reapplied = { reapplied: [], skipped: [] }
  if (root === undefined) return done
  const names = yield* listOriginTools(root, origin).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
  if (names.length === 0) return done
  const live = yield* listPageTools(conn, timeoutMs, sessionId).pipe(
    Effect.orElseSucceed(() => [] as ReadonlyArray<PageTool>)
  )
  const liveNames = new Set(live.map((t) => t.name))
  const reapplied: Array<string> = []
  const skipped: Array<ReapplySkipped> = []
  for (const name of names) {
    if (liveNames.has(name)) {
      skipped.push({ name, reason: "already live (native or shared session) — never overwritten." })
      continue
    }
    const step = yield* Effect.gen(function* () {
      const { spec, body } = yield* loadTool(root, origin, name)
      const def = JSON.stringify({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
        ...(spec.annotations !== undefined ? { annotations: spec.annotations } : {}),
      })
      const value = yield* evaluateJson(conn, registerSnippet(name, def, body), timeoutMs, sessionId)
      const refusal = parseRegisterReply(value, name)
      if (refusal !== null) return { quarantined: refusal }
      const present = yield* listPageTools(conn, timeoutMs, sessionId).pipe(
        Effect.orElseSucceed(() => [] as ReadonlyArray<PageTool>)
      )
      if (!present.some((t) => t.name === name)) return { quarantined: "registered but absent from catalog." }
      if (!spec.consequential) yield* markVerified(root, origin, name).pipe(Effect.ignore)
      return { quarantined: null as string | null }
    }).pipe(Effect.result)
    if (!Result.isSuccess(step)) {
      skipped.push({ name, reason: `re-apply failed (${String(step.failure).slice(0, 160)}) — files kept.` })
    } else if (step.success.quarantined !== null) {
      skipped.push({ name, reason: `${step.success.quarantined} — files kept.` })
    } else {
      reapplied.push(name)
    }
  }
  return { reapplied, skipped }
  })
