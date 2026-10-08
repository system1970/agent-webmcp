import { Console, Effect } from "effect"
import { allTools } from "../tools/registry.ts"

// List registered tools. Works outside any session, so agents can run it
// through bash to see what `mcp serve` would expose. `--json` for scripts.
export const mcpList = (args: ReadonlyArray<string>): Effect.Effect<void, Error> =>
  Effect.gen(function*() {
    if (args.includes("--json")) {
      yield* Console.log(
        JSON.stringify(
          allTools.map((tool) => ({ name: tool.name, description: tool.description })),
          null,
          2
        )
      )
      return
    }
    for (const tool of allTools) {
      yield* Console.log(`${tool.name}\n  ${tool.description}`)
    }
  })
