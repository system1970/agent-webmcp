// register: author a custom tool onto the session page. The spec is the
// STANDARD shape (name/description/inputSchema/annotations — no title);
// the body is data (tool def + JS source), never page code. The fixed
// harness snippet compiles the body debugger-side (CSP-exempt); the
// registered tool is indistinguishable from site-native. Session-scoped:
// close drops everything. Spec rejections fail pre-dial, page rejections
// fail loud.
import { Effect, Result, Schema } from "effect"
import { existsSync } from "node:fs"
import { evaluateJson, invokePageTool, listPageTools } from "../transport/client.ts"
import { SessionStore } from "../sessions/store.ts"
import { reattach } from "../sessions/sessions.ts"
import {
  REGISTRY_ENV,
  resolveProjectRoot,
  saveTool,
  type SavedSpec,
} from "../registry/registry.ts"
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
  fixtureInput: Schema.optional(Schema.Unknown),
  strict: Schema.optional(Schema.Boolean),
  consequential: Schema.optional(Schema.Boolean),
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
          // AbortSignal lifecycle (unregisterTool does not exist in
          // Chromium ≥150 — removal is controller.abort()). One
          // controller per name; re-register aborts the old first so
          // overwrites are idempotent instead of duplicate refusals.
          " window.__agentWebmcp = window.__agentWebmcp ?? {};" +
          " try { window.__agentWebmcp[" +
          JSON.stringify(input.tool.name) +
          "]?.abort(); } catch {}" +
          " const controller = new AbortController();" +
          " window.__agentWebmcp[" +
          JSON.stringify(input.tool.name) +
          "] = controller;" +
          " try { await document.modelContext.registerTool(def, { signal: controller.signal }); }" +
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
        // Fixture proof (non-consequential only): registration succeeding
        // proves nothing — one invoke proves. Frame comes from a fresh
        // catalog read (native source of truth). Failure rolls back BOTH
        // the live tool (unregister, best-effort) and the files (never
        // written — persist happens only after proof passes).
        const consequential = input.tool.consequential === true
        if (input.tool.fixtureInput !== undefined && !consequential) {
          const catalog = yield* listPageTools(conn, timeoutMs, sessionId)
          const live = catalog.find((t) => t.name === input.tool.name)
          if (live === undefined) {
            return yield* Effect.fail(
              new ToolFailed({ tool: "register", detail: "registered but absent from catalog — page dropped it, nothing persisted." })
            )
          }
          const proof = yield* invokePageTool(
            conn,
            sessionId,
            { frameId: live.frameId, toolName: input.tool.name, args: (input.tool.fixtureInput ?? {}) as Record<string, unknown> },
            timeoutMs
          ).pipe(Effect.result)
          if (!Result.isSuccess(proof) || proof.success.status === "Error") {
            const why = !Result.isSuccess(proof)
              ? String(proof.failure).slice(0, 200)
              : String(proof.success.errorText ?? "page error").slice(0, 200)
            yield* evaluateJson(
              conn,
              `(async () => { try { await document.modelContext.unregisterTool(${JSON.stringify(input.tool.name)}); } catch {} return "ok"; })()`,
              5000,
              sessionId
            ).pipe(Effect.ignore)
            return yield* Effect.fail(
              new ToolFailed({ tool: "register", detail: `fixture failed (${why}) — tool rolled back, nothing persisted.` })
            )
          }
        }
        // Persist ALWAYS (no flag): files are the library.
        const writeRoot = resolveProjectRoot(process.cwd(), process.env[REGISTRY_ENV], (d) => existsSync(`${d}/.agent-webmcp`))
        if (writeRoot === undefined) {
          return yield* Effect.fail(
            new ToolFailed({
              tool: "register",
              detail: `live tool registered, but no project root found — set ${REGISTRY_ENV} to persist it (nothing saved).`,
            })
          )
        }
        const savedSpec: SavedSpec = {
          name: input.tool.name,
          description: input.tool.description,
          inputSchema: input.tool.inputSchema as Record<string, unknown>,
          ...(input.tool.annotations !== undefined ? { annotations: input.tool.annotations as Record<string, unknown> } : {}),
          ...(input.tool.fixtureInput !== undefined ? { fixtureInput: input.tool.fixtureInput } : {}),
          ...(input.tool.strict !== undefined ? { strict: input.tool.strict } : {}),
          ...(consequential ? { consequential: true as const } : {}),
          version: 1 as const,
          createdAt: Date.now(),
          lastVerified: input.tool.fixtureInput !== undefined && !consequential ? Date.now() : undefined,
        }
        yield* saveTool(writeRoot, record.origin, input.tool.name, savedSpec, input.code)
        yield* store.save({ ...record, authored: [...record.authored, input.tool.name] })
        return { content: JSON.stringify({ registered: input.tool.name, handle: input.handle, persisted: true }) }
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
