import { Console, Effect } from "effect"
import { statusSessions } from "../sessions/verbs.ts"
import { UsageError } from "../failure.ts"

// status [--json]: read-only observability over records, never browsers.
// Thin argv shell over verbs.statusSessions; printing only here.
export const status = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    let json = false
    for (const arg of args) {
      if (arg === "--json") {
        json = true
      } else {
        return yield* Effect.fail(new UsageError({ message: "status: Usage: status [--json]" }))
      }
    }
    const report = yield* statusSessions()
    if (json) {
      yield* Console.log(JSON.stringify(report, null, 2))
      return yield* Effect.void
    }
    yield* Console.log(`sessions open: ${report.sessions.length}`)
    for (const s of report.sessions) {
      yield* Console.log(`  ${s.handle}  ${s.url}`)
    }
    yield* Console.log(`spill: ${report.spill.files} file(s), ${report.spill.bytes} bytes`)
    return yield* Effect.void
  })
