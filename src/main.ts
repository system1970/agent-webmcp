import { Effect } from "effect"
import { dispatch } from "./cli.ts"

// Thin entry: parse, run, map errors to exit codes. 0 is success, 2 is a
// usage error, 1 is everything else.
const handled = dispatch(Bun.argv.slice(2)).pipe(
  Effect.catchTag("UsageError", (error) =>
    Effect.sync(() => {
      console.error(`usage error: ${error.message}`)
      process.exit(2)
    })
  )
)

const exit = await Effect.runPromiseExit(handled)
if (exit._tag === "Failure") {
  console.error(exit.cause)
  process.exit(1)
}
