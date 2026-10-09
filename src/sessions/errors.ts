// Session failures: store problems only. Browser/page problems stay
// TransportFailed; verb problems get their own taxonomy later.
import { Data } from "effect"

export type StoreReason = "missing" | "corrupt" | "io" | "bad-url" | "no-port"

export class StoreFailed extends Data.TaggedError("StoreFailed")<{
  readonly reason: StoreReason
  readonly handle?: string
  readonly message: string
  readonly fix: string
}> {}
