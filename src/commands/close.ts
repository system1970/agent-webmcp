import { Console, Effect } from "effect"
import { closeSession, closeAllSessions } from "../sessions/verbs.ts"
import { UsageError, CliFailure } from "../failure.ts"

// close <handle|--all>: thin argv shell over verbs.closeSession(s).
export const close = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const [target, extra] = args
    if (target === undefined || extra !== undefined || (target.startsWith("-") && target !== "--all")) {
      return yield* Effect.fail(new UsageError({ message: "close: Usage: close <handle|--all>" }))
    }
    if (target === "--all") {
      const summary = yield* closeAllSessions()
      for (const failed of summary.failed) {
        yield* Console.log(`close --all: '${failed.handle}' failed: ${failed.message} (record kept)`)
      }
      yield* Console.log(`closed ${summary.closed.length}/${summary.closed.length + summary.failed.length} session(s)`)
      if (summary.failed.length > 0) {
        return yield* Effect.fail(new CliFailure({ message: `close --all: ${summary.failed.length} session(s) failed (see lines above)` }))
      }
      return yield* Effect.void
    }
    yield* closeSession(target)
    yield* Console.log(`closed ${target}`)
    return yield* Effect.void
  })
