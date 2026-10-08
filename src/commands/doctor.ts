import { Effect } from "effect"
import { allTools } from "../tools/registry.ts"
import { getEffectVersion } from "../version.ts"

// Report the runtime environment. Facts only: versions and counts, no
// judgments. `--json` prints the same facts as JSON for scripting.
export const doctor = (args: ReadonlyArray<string>): Effect.Effect<void, Error> =>
  Effect.gen(function*() {
    const json = args.includes("--json")
    const effectVersion = yield* getEffectVersion
    const report = {
      bun: Bun.version,
      platform: `${process.platform}/${process.arch}`,
      effect: effectVersion,
      tools: allTools.map((tool) => tool.name)
    }
    if (json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`bun:      ${report.bun}`)
      console.log(`platform: ${report.platform}`)
      console.log(`effect:   ${report.effect}`)
      console.log(`tools:    ${report.tools.join(", ") || "(none)"}`)
    }
  })
