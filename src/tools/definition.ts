// Tool definition: one surface for MCP and CLI doors. A tool is a name,
// a blurb, a derived input schema, and an execute that never throws —
// failures are ToolFailed (tagged, with the model-facing message ON the
// class), defects pass through loud.
import { Data, Effect, Schema } from "effect"
import type { TransportFailed } from "../transport/errors.ts"
import type { Browser } from "../sessions/sessions.ts"
import type { SessionStore } from "../sessions/store.ts"
import type { StoreFailed } from "../sessions/errors.ts"

export class ToolFailed extends Data.TaggedError("ToolFailed")<{
  readonly tool: string
  readonly detail: string
}> {
  override get message(): string {
    return `${this.tool}: ${this.detail}`
  }
}

export interface ToolCtx {
  readonly sessionID?: string
  readonly agent?: string
}

export interface ToolResult {
  readonly content: string
}

export interface WebmcpTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly execute: (
    args: unknown,
    ctx: ToolCtx
  ) => Effect.Effect<ToolResult, VerbError, VerbServices>
}

// Verb error + services, stated once. Doors (MCP/CLI) provide the layers;
// verbs never construct them. Type-only imports: no runtime cycle.
export type VerbError = ToolFailed | StoreFailed | TransportFailed
export type VerbServices = SessionStore | Browser

// Shared verb budgets. One block so windows stay debated once.
export const INVOKE_TIMEOUT_MS = 30000
export const INVOKE_TIMEOUT_MAX_MS = 300000
export const RUN_MAX_CODE_CHARS = 64000
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/

// Derive MCP inputSchema from the Effect schema — one schema is the truth.
// MCP requires top-level {type:"object"}; an empty struct derives
// something typeless and ONE typeless tool poisons the whole tools/list,
// so anything non-object collapses (every tool input is a struct that
// ignores extra keys, so the collapse is truthful). Locked by unit test.
export const toInputSchema = <A>(schema: Schema.Schema<A>): Record<string, unknown> => {
  const doc = Schema.toJsonSchemaDocument(schema)
  const derived = doc.schema as Record<string, unknown>
  if (derived["type"] === "object") return derived
  const { ...rest } = derived
  return { ...rest, type: "object" }
}

// Decode door args: unknown in, typed struct out, failures named.
export const decodeArgs =
  <A>(schema: Schema.Schema<A>, tool: string) =>
  (args: unknown): Effect.Effect<A, ToolFailed> =>
    Effect.try({
      try: () => {
        Schema.asserts(schema, args)
        return args
      },
      catch: (err) =>
        new ToolFailed({
          tool,
          detail: `bad args: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
        }),
    })
