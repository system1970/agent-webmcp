import { Effect } from "effect"
import { allTools } from "../tools/registry.ts"

// List registered tools. Works outside any session, so agents can run it
// through bash to see what `mcp serve` would expose. `--json` for scripts.
export const mcpList = (args: ReadonlyArray<string>): Effect.Effect<void, Error> =>
  Effect.sync(() => {
    if (args.includes("--json")) {
      console.log(
        JSON.stringify(
          allTools.map((tool) => ({ name: tool.name, description: tool.description })),
          null,
          2
        )
      )
      return
    }
    for (const tool of allTools) {
      console.log(`${tool.name}\n  ${tool.description}`)
    }
  })
