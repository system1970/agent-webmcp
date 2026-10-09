// execute: run code over session tools. Single handle → flat tools;
// sessions[] → namespaced by alias (`as`, else s1..sN). Budgets validated
// pre-dial (ToolFailed), enforced during (runner). Envelope always carries
// untrusted:true — page data is never instructions.
import { Effect, Schema } from "effect"
import { invokePageTool, listPageTools } from "../transport/client.ts"
import { SessionStore } from "../sessions/store.ts"
import { reattach } from "../sessions/sessions.ts"
import { CallFailed, runCode, type CallFn } from "../codemode/runner.ts"
import {
  decodeArgs,
  toInputSchema,
  ToolFailed,
  type ToolCtx,
  type WebmcpTool,
} from "./definition.ts"

const SessionRef = Schema.Struct({
  handle: Schema.String,
  as: Schema.optional(Schema.String),
})

const Input = Schema.Struct({
  handle: Schema.optional(Schema.String),
  sessions: Schema.optional(Schema.Array(SessionRef)),
  code: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
  maxToolCalls: Schema.optional(Schema.Number),
  maxChars: Schema.optional(Schema.Number),
  maxResultChars: Schema.optional(Schema.Number),
})

const TIMEOUT_DEFAULT_MS = 60000
const TIMEOUT_MAX_MS = 300000
const MAX_CALLS_DEFAULT = 25
const MAX_CHARS_DEFAULT = 16000
const MAX_RESULT_CHARS_DEFAULT = 64000
const MAX_CODE_CHARS = 64000

export const execute: WebmcpTool = {
  name: "execute",
  description:
    "Run code over session tools ({value, spilled, toolCalls, perSession, origins, untrusted:true}). One handle for flat tools, or sessions[] for namespaced joins (alias via as, else s1..sN). Budgets validated pre-dial, enforced during.",
  inputSchema: toInputSchema(Input),
  execute: (args: unknown, _ctx: ToolCtx) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(Input, "execute")(args)
      const timeoutMs = input.timeoutMs ?? TIMEOUT_DEFAULT_MS
      const maxToolCalls = input.maxToolCalls ?? MAX_CALLS_DEFAULT
      const maxChars = input.maxChars ?? MAX_CHARS_DEFAULT
      const maxResultChars = input.maxResultChars ?? MAX_RESULT_CHARS_DEFAULT
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MAX_MS) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", detail: `bad timeoutMs: want 1-${TIMEOUT_MAX_MS} ms` }))
      }
      for (const [name, value] of [["maxToolCalls", maxToolCalls], ["maxChars", maxChars], ["maxResultChars", maxResultChars]] as const) {
        if (!Number.isInteger(value) || value < 1) {
          return yield* Effect.fail(new ToolFailed({ tool: "execute", detail: `bad ${name}: want an integer ≥ 1` }))
        }
      }
      if (input.code.trim().length === 0) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", detail: "code is empty." }))
      }
      if (input.code.length > MAX_CODE_CHARS) {
        return yield* Effect.fail(
          new ToolFailed({ tool: "execute", detail: `code is ${input.code.length} chars (max ${MAX_CODE_CHARS}): chunk it.` })
        )
      }
      const refs =
        input.sessions !== undefined
          ? input.sessions.map((s, i) => ({ handle: s.handle, as: s.as ?? `s${i + 1}` }))
          : input.handle !== undefined
            ? [{ handle: input.handle, as: "page" }]
            : []
      if (refs.length === 0) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", detail: "pass handle or sessions." }))
      }
      if (refs.length > 8) {
        return yield* Effect.fail(new ToolFailed({ tool: "execute", detail: "at most 8 sessions per run: close something first." }))
      }
      const store = yield* SessionStore
      const flat = refs.length === 1
      const calls: Record<string, CallFn> = {}
      const perAliasFrame = new Map<string, Map<string, string>>()
      const attached: Array<{ alias: string; handle: string; close: Effect.Effect<void> }> = []
      try {
        for (const ref of refs) {
          const record = yield* store.load(ref.handle)
          const { conn, sessionId } = yield* reattach(record)
          attached.push({ alias: ref.as, handle: ref.handle, close: conn.close })
          const tools = yield* listPageTools(conn, 10000, sessionId)
          const frames = new Map(tools.map((t) => [t.name, t.frameId]))
          perAliasFrame.set(ref.as, frames)
          for (const tool of tools) {
            const path = flat ? tool.name : `${ref.as}.${tool.name}`
            calls[path] = ((toolName: string, frameId: string) => (input: unknown) =>
              Effect.gen(function* () {
                const args = (input ?? {}) as Record<string, unknown>
                const out = yield* invokePageTool(conn, sessionId, { frameId, toolName, args }, timeoutMs).pipe(
                  Effect.mapError((err) => new CallFailed({ message: `${toolName}: ${err.message.slice(0, 300)}` }))
                )
                if (out.status === "Error") {
                  return yield* Effect.fail(new CallFailed({ message: `${toolName}: ${String(out.errorText ?? "page error").slice(0, 300)}` }))
                }
                return out.output ?? null
              }))(tool.name, tool.frameId)
          }
        }
        const result = yield* runCode({ code: input.code, calls, budgets: { timeoutMs, maxToolCalls, maxChars, maxResultChars } })
        const perSession: Record<string, number> = {}
        for (const [alias] of perAliasFrame) perSession[alias] = 0
        if (result.ok) {
          for (const path of result.calls) {
            const alias = flat ? (refs[0] as { as: string }).as : path.split(".")[0] ?? "?"
            perSession[alias] = (perSession[alias] ?? 0) + 1
          }
          return {
            content: JSON.stringify({
              value: result.value,
              spilled: result.spilled,
              toolCalls: result.toolCalls,
              perSession,
              origins: refs.map((r) => r.handle),
              untrusted: true,
            }),
          }
        }
        return {
          content: JSON.stringify({
            value: null,
            spilled: false,
            toolCalls: result.toolCalls,
            perSession,
            origins: refs.map((r) => r.handle),
            untrusted: true,
            error: result.error,
          }),
        }
      } finally {
        for (const a of attached) yield* a.close
      }
    }),
}
