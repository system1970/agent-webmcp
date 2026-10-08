import { Console, Effect } from "effect"
import { dispatch } from "./cli.ts"

// Thin entry: parse, run, resolve to an exit code. 0 is success, 2 is a
// usage error, 1 is everything else. process.exit runs here at the edge,
// after runPromiseExit settles, so finalizers already ran and the full
// cause is available for unexpected failures.
const handled = dispatch(Bun.argv.slice(2)).pipe(
  Effect.catchTag("UsageError", (error) =>
    Console.error(`usage error: ${error.message}`).pipe(Effect.as(2))
  )
)

const exit = await Effect.runPromiseExit(handled)
if (exit._tag === "Failure") {
  console.error(exit.cause)
  process.exit(1)
}
process.exit(exit.value ?? 0)
