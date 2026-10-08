import { Data, Effect, Schema } from "effect"

// A tool the agent can call. One definition, two doors: the CLI and the MCP
// server both read from the registry. Add a tool by adding one file and one
// line in `registry.ts`. Nothing else changes.
export interface WebmcpTool {
  readonly name: string
  readonly description: string
  // MCP `inputSchema`. Kept next to the Effect schema below so the two stay
  // in sync by inspection. No codegen until we have enough tools to earn it.
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

// Derive an MCP `inputSchema` from the tool's Effect schema. One schema is
// the truth; the JSON Schema is computed. Anonymous structs inline fully.
// Named (identifier-annotated) schemas land in `definitions` instead —
// keep tool inputs anonymous until a tool earns `$defs` handling.
export const toInputSchema = (schema: Schema.Constraint): Record<string, unknown> =>
  Schema.toJsonSchemaDocument(schema).schema as Record<string, unknown>
