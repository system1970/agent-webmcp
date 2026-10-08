import { Data } from "effect"
import { TransportFailed } from "../transport/errors.ts"

// Usage mistakes: exit 2 with the usage line. Lives here (not cli.ts) so
// commands can raise it without importing the dispatcher.
export class UsageError extends Data.TaggedError("UsageError")<{
  readonly message: string
}> {}

// Operational CLI failures: honest errors with exit 1 and a clean stderr
// line. Usage mistakes stay UsageError (exit 2); everything unexpected
// stays a defect dump (exit 1 via main). This is the middle lane.
export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly message: string
}> {}

// Render a transport failure for stderr: reason names the class, operation
// the verb, fix the next action. One line, no protocol dump.
export const asCliFailure = (failure: TransportFailed): CliFailure =>
  new CliFailure({
    message: `${failure.reason} ${failure.operation}: ${failure.message}` +
      (failure.fix !== undefined ? ` :: ${failure.fix}` : "")
  })
