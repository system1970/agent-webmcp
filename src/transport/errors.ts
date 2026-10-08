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

// WebMCP is the core, not an opt-in — but Chromium still gates the page
// surface behind a Testing flag on some origins. Verified live (152):
// https pages expose modelContext unflagged; http (incl. localhost)
// answers undefined without the flag and object with it. So every
// browser we launch carries it: no-op where it ships, required where
// it doesn't. A browser that lacks WebMCP even WITH the flag is older
// than our floor (152+), and the fix says so.
export const WEBMCP_LAUNCH_FLAGS = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport"

export const webmcpFloorFix =
  "use Chromium 152 or newer: WebMCP ships built-in. Older builds are below the engine floor."
