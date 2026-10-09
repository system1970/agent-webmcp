// Transport failures: every CDP/launch problem the engine can name.
// reason is the matchable code, fix is the stranger-facing repair.
// Nothing else in the engine invents transport failures.
import { Data } from "effect"

export type TransportReason = "no-browser" | "connect" | "timeout" | "decode" | "page"

export class TransportFailed extends Data.TaggedError("TransportFailed")<{
  readonly reason: TransportReason
  readonly operation: string
  readonly message: string
  readonly fix: string
}> {}
