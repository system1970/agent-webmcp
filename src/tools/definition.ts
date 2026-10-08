import { Data, Effect, Schema } from "effect"
import { asCliFailure } from "../failure.ts"
import type { CliFailure } from "../failure.ts"
import type { TransportFailed } from "../transport/errors.ts"

// A tool the agent can call. One definition, two doors: the CLI and the MCP
// server both read from the registry. Add a tool by adding one file and one
// line in `registry.ts`. Nothing else changes.
export interface WebmcpTool {
  readonly name: string
  readonly description: string
  // MCP `inputSchema`. Computed from the Effect schema via `toInputSchema`
  // below — one schema is the truth. Descriptions ride along as
  // annotations and flow into the derived JSON Schema.
  readonly inputSchema: Record<string, unknown>
  readonly execute: (args: unknown) => Effect.Effect<ToolResult, ToolFailed>
}

export interface ToolResult {
  readonly content: string
}

export class ToolFailed extends Data.TaggedError("ToolFailed")<{
  readonly tool: string
  readonly message: string
}> {} 

// Map session-verb failures into ToolFailed: CliFailure messages are
// already agent-facing; TransportFailed renders through the same one-line
// format the CLI prints. Defects pass through untouched (loud, by design).
export const catchSession = (tool: string) =>
  <A>(self: Effect.Effect<A, CliFailure | TransportFailed>): Effect.Effect<A, ToolFailed> =>
    self.pipe(
      Effect.catchTag("CliFailure", (f) => Effect.fail(new ToolFailed({ tool, message: f.message }))),
      Effect.catchTag("TransportFailed", (f) => Effect.fail(new ToolFailed({ tool, message: asCliFailure(f).message })))
    );

// Tool registry: each tool module self-registers on import, so no tool
// module ever imports the manifest (import cycles used to make load
// order load-bearing — a module imported before the manifest crashed
// with "Cannot access before initialization"). The manifest
// (registry.ts) imports every tool file for side effects exactly once.
// Add a tool by writing `src/tools/<name>.ts` calling registerTool.
const entries: Array<WebmcpTool> = []

export const registerTool = (tool: WebmcpTool): void => {
  entries.push(tool)
}

export const allTools: ReadonlyArray<WebmcpTool> = entries

export const findTool = (name: string): WebmcpTool | undefined =>
  entries.find((tool) => tool.name === name)

// Derive an MCP `inputSchema` from the tool's Effect schema. One schema is
// the truth; the JSON Schema is computed. Anonymous structs inline fully.
// Named (identifier-annotated) schemas land in `definitions` instead —
// keep tool inputs anonymous until a tool earns `$defs` handling.
export const toInputSchema = (schema: Schema.Constraint): Record<string, unknown> =>
  Schema.toJsonSchemaDocument(schema).schema as Record<string, unknown>
