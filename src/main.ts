import { Console, Effect } from "effect"
import { CliFailure, UsageError } from "./failure.ts"
import { dispatch } from "./cli.ts"

// Thin entry: parse, run, resolve to an exit code. 0 is success, 2 is a
// usage error, 1 is everything else. Rule: inside the runtime side effects
// go through `Console`; past `runPromiseExit` the runtime has settled, so
// the edge uses raw process I/O (stderr + exit code) by design.
const handled = dispatch(Bun.argv.slice(2)).pipe(
  Effect.catchTags({
    UsageError: (error) => Console.error(`usage error: ${error.message}`).pipe(Effect.as(2)),
    CliFailure: (error) => Console.error(`error: ${error.message}`).pipe(Effect.as(1))
  })
)

const exit = await Effect.runPromiseExit(handled)
if (exit._tag === "Failure") {
  process.stderr.write(Bun.inspect(exit.cause) + "\n")
  process.exit(1)
}
process.exit(exit.value ?? 0)
