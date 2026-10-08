import { Data, Effect } from "effect"
import { doctor } from "./commands/doctor.ts"
import { mcpList } from "./commands/mcp-list.ts"
import { mcpServe } from "./commands/mcp-serve.ts"
import { getVersion } from "./version.ts"

// Pi-shaped dispatch: a flat table of commands, each a name plus an Effect.
// No framework: parsing is prefix matching on argv, errors are tagged values
// mapped to exit codes in `main.ts`. Adding a command means adding one row.
export class UsageError extends Data.TaggedError("UsageError")<{
  readonly message: string
}> {}

interface Command {
  readonly name: string
  readonly description: string
  readonly usage: string
  readonly run: (args: ReadonlyArray<string>) => Effect.Effect<void, Error>
}

const commands: ReadonlyArray<Command> = [
  {
    name: "doctor",
    description: "Report the runtime environment (bun, platform, effect, tools).",
    usage: "doctor [--json]",
    run: doctor
  },
  {
    name: "mcp",
    description: "Work with the MCP surface: `list` prints tools, `serve` exposes them over stdio.",
    usage: "mcp (list [--json] | serve)",
    run: (args) => {
      const [sub, ...rest] = args
      if (sub === "list") return mcpList(rest)
      if (sub === "serve") return mcpServe
      return Effect.fail(
        new UsageError({ message: `mcp expects 'list' or 'serve', got '${sub ?? "(nothing)"}'` })
      )
    }
  }
]

const helpText = (version: string): string => [
  `agent-webmcp ${version} — the web as the agent's toolkit`,
  ``,
  `usage: agent-webmcp [--version | --help] <command> [args]`,
  ``,
  ...commands.map((c) => `  ${c.usage}\n    ${c.description}`),
  ``
].join("\n")

export const dispatch = (argv: ReadonlyArray<string>): Effect.Effect<void, UsageError | Error> =>
  Effect.gen(function*() {
    const version = yield* getVersion
    const [name, ...rest] = argv
    if (name === undefined || name === "--help" || name === "-h") {
      console.log(helpText(version))
      return
    }
    if (name === "--version" || name === "-v") {
      console.log(version)
      return
    }
    const command = commands.find((c) => c.name === name)
    if (command === undefined) {
      return yield* Effect.fail(
        new UsageError({ message: `unknown command '${name}'. Run with --help.` })
      )
    }
    yield* command.run(rest)
  })
