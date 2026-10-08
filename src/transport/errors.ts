import { Schema } from "effect"

// Every transport failure names the failed operation, what happened, and
// the fix. The fix is the point: a novel string has zero model priors, so
// the error must imply the next action (errno discipline, not CDP codes).
export class TransportFailed extends Schema.TaggedError<TransportFailed>()("TransportFailed", {
  reason: Schema.Literals(["no-browser", "flags-missing", "timeout", "protocol", "navigated"]),
  operation: Schema.String,
  message: Schema.String,
  // Numeric CDP refusal code when the failure is a browser refusal
  // (e.g. -32601 method-not-found). Matched structurally, never parsed
  // back out of the message.
  code: Schema.optional(Schema.Number),
  fix: Schema.optional(Schema.String)
}) {}

// WebMCP is the core, not a feature flag: supported browsers ship it
// natively (verified: Chromium 152 registers page tools with no flags).
// There is no flags path in this codebase — a browser that needs
// --enable-features=WebMCPTesting,DevToolsWebMCPSupport to speak WebMCP
// is older than our floor (152+), and the fix says so.
export const webmcpFloorFix =
  "use Chromium 152 or newer: WebMCP ships built-in, no flags. Older builds are below the engine floor."
