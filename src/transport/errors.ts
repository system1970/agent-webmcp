import { Schema } from "effect"

// Every transport failure names the failed operation, what happened, and
// the fix. The fix is the point: a novel string has zero model priors, so
// the error must imply the next action (errno discipline, not CDP codes).
export class TransportFailed extends Schema.TaggedError<TransportFailed>()("TransportFailed", {
  reason: Schema.Literals(["no-browser", "flags-missing", "timeout", "protocol"]),
  operation: Schema.String,
  message: Schema.String,
  // Numeric CDP refusal code when the failure is a browser refusal
  // (e.g. -32601 method-not-found). Matched structurally, never parsed
  // back out of the message.
  code: Schema.optional(Schema.Number),
  fix: Schema.optional(Schema.String)
}) {}

// Launch flags for Chromium builds that gate WebMCP behind them (pre-152
// behavior; 152 ships unflagged). Source: Stagehand's default launch flags,
// verified against Chromium 152's /json/protocol.
export const WEBMCP_FLAGS = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport"

export const flagsFix = (exe: string): string =>
  `relaunch with WebMCP enabled: ${exe} --headless --remote-debugging-port=PORT ${WEBMCP_FLAGS}`
