import { Console, Effect } from "effect"
import skillMd from "../../skills/agent-webmcp/SKILL.md" with { type: "text" }
import { UsageError } from "../failure.ts"

// skill show: print the bundled skill — version-matched by construction.
// The doc describes exactly this binary's surface (same registry, same
// verbs), so it cannot drift from the code it teaches.
export const skill = (args: ReadonlyArray<string>): Effect.Effect<void, UsageError> =>
  Effect.gen(function* () {
    const [sub] = args
    if (sub === undefined || sub === "show") {
      yield* Console.log(skillMd.trimEnd())
      return yield* Effect.void
    }
    return yield* Effect.fail(new UsageError({ message: `skill: unknown '${sub}'. Usage: skill show` }))
  })
