// register: author a custom tool onto the session page. The spec is the
// STANDARD shape (name/description/inputSchema/annotations — no title);
// the body is data (tool def + JS source), never page code. The fixed
// harness snippet compiles the body debugger-side (CSP-exempt); the
// registered tool is indistinguishable from site-native. Session-scoped:
// close drops everything. Spec rejections fail pre-dial, page rejections
// fail loud.
import { Effect, Schema } from "effect"
import { evaluateJson } from "../transport/client.ts"
import { SessionStore } from "../sessions/store.ts"
import { reattach } from "../sessions/sessions.ts"
import {
  decodeArgs,
  INVOKE_TIMEOUT_MAX_MS,
  INVOKE_TIMEOUT_MS,
  RUN_MAX_CODE_CHARS,
  toInputSchema,
  ToolFailed,
  TOOL_NAME_PATTERN,
  type ToolCtx,
  type WebmcpTool,
} from "./definition.ts"

const Spec = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Record(Schema.String, Schema.Unknown),
  annotations: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

const Input = Schema.Struct({
  handle: Schema.String,
  tool: Spec,
  code: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
})

export const register: WebmcpTool = {
  name: "register",
  description:
    "Author a custom tool onto the session page: spec (name/description/inputSchema/annotations?) plus JS body source. Registers natively via document.modelContext; session-scoped, close drops it. Spec rejections fail pre-dial, page refusals fail loud.",
  inputSchema: toInputSchema(Input),
  execute: (args: unknown, _ctx: ToolCtx) =>
    Effect.gen(function* () {
      const input = yield* decodeArgs(Input, "register")(args)
      const timeoutMs = input.timeoutMs ?? INVOKE_TIMEOUT_MS
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > INVOKE_TIMEOUT_MAX_MS) {
        return yield* Effect.fail(
          new ToolFailed({ tool: "register", detail: `bad timeoutMs '${input.timeoutMs}': want 1-${INVOKE_TIMEOUT_MAX_MS} ms` })
        )
      }
      const specError = checkSpec(
        { name: input.tool.name, description: input.tool.description, inputSchema: input.tool.inputSchema },
        input.code
      )
      if (specError !== null) {
        return yield* Effect.fail(new ToolFailed({ tool: "register", detail: `${specError} (spec rejects, pre-dial).` }))
      }
      const store = yield* SessionStore
      const record = yield* store.load(input.handle)
      const { conn, sessionId } = yield* reattach(record)
      try {
        const def = JSON.stringify({
          name: input.tool.name,
          description: input.tool.description,
          inputSchema: input.tool.inputSchema,
          ...(input.tool.annotations !== undefined ? { annotations: input.tool.annotations } : {}),
        })
        const snippet =
          "(async () => {" +
          " const execute = (" +
          input.code +
          ");" +
          " if (typeof execute !== 'function') return JSON.stringify({ error: 'code is not a function expression' });" +
          " const def = " +
          def +
          "; def.execute = execute;" +
          " try { await document.modelContext.registerTool(def); }" +
          " catch (e) { return JSON.stringify({ error: String((e && e.message) || e).slice(0, 300) }); }" +
          " return JSON.stringify({ registered: def.name });" +
          "})()"
        const value = yield* evaluateJson(conn, snippet, timeoutMs, sessionId)
        if (typeof value !== "string") {
          return yield* Effect.fail(new ToolFailed({ tool: "register", detail: "page returned non-JSON (contract broken)." }))
        }
        const parsed: unknown = yield* Effect.try({
          try: () => JSON.parse(value) as unknown,
          catch: () => new ToolFailed({ tool: "register", detail: "page returned non-JSON (contract broken)." }),
        })
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("registered" in parsed || "error" in parsed) ||
          (parsed as { registered?: unknown }).registered !== input.tool.name
        ) {
          const refusal =
            typeof parsed === "object" && parsed !== null && "error" in parsed
              ? String((parsed as { error: unknown }).error).slice(0, 200)
              : "unexpected shape"
          return yield* Effect.fail(new ToolFailed({ tool: "register", detail: `page refused: ${refusal}` }))
        }
        return { content: JSON.stringify({ registered: input.tool.name, handle: input.handle }) }
      } finally {
        yield* conn.close
      }
    }),
}

// Shape check, exported for unit tests (no browser needed).
export const checkSpec = (
  tool: { name: string; description: string; inputSchema: unknown },
  code: string
): string | null => {
  if (!TOOL_NAME_PATTERN.test(tool.name)) return `bad tool name '${tool.name}'`
  if (tool.description.trim().length === 0) return "description is empty"
  if (typeof tool.inputSchema !== "object" || tool.inputSchema === null || Array.isArray(tool.inputSchema)) {
    return "inputSchema must be a JSON Schema object"
  }
  if (code.trim().length === 0) return "code is empty"
  if (code.length > RUN_MAX_CODE_CHARS) return `code too long (${code.length})`
  return null
}
