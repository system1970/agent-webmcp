import { Data } from "effect"
import type { TransportFailed } from "./transport/errors.ts"

// Usage mistakes: exit 2 with the usage line. Lives here (not cli.ts) so
// commands can raise it without importing the dispatcher.
export class UsageError extends Data.TaggedError("UsageError")<{
  readonly message: string
}> {}

// Operational CLI failures: honest errors with exit 1 and a clean stderr
// line. Usage mistakes stay UsageError (exit 2); transients stay
// TransientFailure (exit 3, safe to retry); everything unexpected stays
// a defect dump (exit 1 via main). This is the middle lane.
export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly message: string
}> {}

// Transient infrastructure failures: exit 3, safe to retry without
// changing the invocation (browser died, stall timed out). Anything
// needing a fix stays CliFailure (exit 1); anything malformed stays
// UsageError (exit 2). The code IS the retry policy — agents branch
// on it instead of parsing prose.
export class TransientFailure extends Data.TaggedError("TransientFailure")<{
  readonly message: string
}> {}

// Render a transport failure for stderr: reason names the class, operation
// the verb, fix the next action. One line, no protocol dump.
export const asCliFailure = (failure: TransportFailed): CliFailure =>
  new CliFailure({
    message: `${failure.reason} ${failure.operation}: ${failure.message}` +
      (failure.fix !== undefined ? ` :: ${failure.fix}` : "")
  })

// Command-layer mapping: timeout and no-browser are transient (exit 3,
// safe to retry unchanged); everything else keeps the CliFailure lane
// (exit 1). The "(transient…)" hint text rides the CLI message;
// verbs/MCP stay on asCliFailure (no exits there).
export const asCommandFailure = (failure: TransportFailed): CliFailure | TransientFailure => {
  const base = asCliFailure(failure)
  if (failure.reason === "timeout" || failure.reason === "no-browser") {
    return new TransientFailure({ message: `${base.message} (transient: safe to retry)` })
  }
  return base
}

// Machine-door default: JSON unless the caller forces rows (--plain) or
// opted in (--json), or output is a terminal (a human reading). Piped,
// captured, or unknown output is machine output.
export const resolveJson = (opts: { json: boolean; plain: boolean; isTTY: boolean | undefined }): boolean =>
  opts.plain ? false : opts.json ? true : opts.isTTY !== true
