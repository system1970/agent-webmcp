import { Console, Effect } from "effect"
import { closeSession, closeAllSessions } from "../sessions/verbs.ts"
import { UsageError, CliFailure, resolveJson } from "../failure.ts"

// close <handle|--all> [--yes] [--json|--plain]: thin argv shell over
// verbs.closeSession(s). Killing browsers is deliberate: --yes confirms.
export const close = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let target: string | undefined
    let yes = false
    let json = false
    let plain = false
    for (const arg of args) {
      if (arg === "--yes") {
        yes = true
      } else if (arg === "--json") {
        json = true
      } else if (arg === "--plain") {
        plain = true
      } else if (arg === "--all" && target === undefined) {
        target = arg
      } else if (arg.startsWith("-") || target !== undefined) {
        return yield* Effect.fail(new UsageError({ message: `close: unexpected '${arg}'. Usage: close <handle|--all> [--yes] [--json|--plain]` }))
      } else {
        target = arg
      }
    }
    if (target === undefined || (target.startsWith("-") && target !== "--all")) {
      return yield* Effect.fail(new UsageError({ message: "close: Usage: close <handle|--all> [--yes] [--json|--plain]" }))
    }
    if (!yes) {
      return yield* Effect.fail(new UsageError({ message: "close: needs --yes (kills browsers we launched): pass --yes to confirm." }))
    }
    const outJson = resolveJson({ json, plain, isTTY: process.stdout.isTTY })
    if (target === "--all") {
      const summary = yield* closeAllSessions()
      if (outJson) {
        yield* Console.log(JSON.stringify({ closed: summary.closed, failed: summary.failed }))
      } else {
        for (const failed of summary.failed) {
          yield* Console.log(`close --all: '${failed.handle}' failed: ${failed.message} (record kept)`)
        }
        yield* Console.log(`closed ${summary.closed.length}/${summary.closed.length + summary.failed.length} session(s)`)
      }
      if (summary.failed.length > 0) {
        return yield* Effect.fail(new CliFailure({ message: `close --all: ${summary.failed.length} session(s) failed (see lines above)` }))
      }
      return yield* Effect.void
    }
    yield* closeSession(target)
    if (outJson) {
      yield* Console.log(JSON.stringify({ closed: [target] }))
    } else {
      yield* Console.log(`closed ${target}`)
    }
    return yield* Effect.void
  })
