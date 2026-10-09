import { Console, Effect } from "effect"
import { CliFailure, UsageError } from "./failure.ts"
import { doctor } from "./commands/doctor.ts"
import { mcpList } from "./commands/mcp-list.ts"
import { mcpServe } from "./commands/mcp-serve.ts"
import { open } from "./commands/open.ts"
import { list } from "./commands/list.ts"
import { invoke } from "./commands/invoke.ts"
import { close } from "./commands/close.ts"
import { search } from "./commands/search.ts"
import { execute } from "./commands/execute.ts"
import { status } from "./commands/status.ts"
import { inject } from "./commands/inject.ts"
import { skill } from "./commands/skill.ts"
import { getVersion } from "./version.ts"
import { RUN_TIMEOUT_MAX_MS, INVOKE_TIMEOUT_MAX_MS } from "./budgets.ts"

// Pi-shaped dispatch: a flat table of commands, each a name plus an Effect.
// No framework: parsing is prefix matching on argv, errors are tagged values
// mapped to exit codes in `main.ts`. Adding a command means adding one row.

interface Command {
  readonly name: string
  readonly description: string
  readonly usage: string
  readonly run: (args: ReadonlyArray<string>) => Effect.Effect<void, UsageError | CliFailure | Error>
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
  },
  {
    name: "open",
    description: "Attach a page and record a session handle. Own browser by default; --cdp borrows (and navigates) a tab of a foreign browser.",
    usage: "open [--cdp URL [--target SUB]] [--port N] [--json] <url>",
    run: open
  },
  {
    name: "list",
    description: "Show a session's page tools (stat-like rows; full schema on demand).",
    usage: "list <handle> [tool] [--json]",
    run: list
  },
  {
    name: "invoke",
    description: "Call one page tool by name with JSON args.",
    usage: `invoke <handle> <tool> '<json>' [--timeout ms 1-${INVOKE_TIMEOUT_MAX_MS}] [--json]`,
    run: invoke
  },
  {
    name: "close",
    description: "Release a session (kills browsers we launched, never foreign ones).",
    usage: "close <handle|--all>",
    run: close
  },
  {
    name: "search",
    description: "Find tools by words (engine + session page tools with --handle/--all).",
    usage: "search [--json] [--handle H ...] [--all] [--limit 1–50] <query...>",
    run: search
  },
  {
    name: "execute",
    description: "Run JS code against session page tools, one turn per flow (single --session, --handle aliases it; multi: repeat --as ALIAS=H). Accident-contained, runs with your privilege.",
    usage: `execute [--session H | --as ALIAS=H ...] [--timeout ms 1-${RUN_TIMEOUT_MAX_MS}] [--max-chars N] [--json] '<code>'`,
    run: execute
  },
  {
    name: "status",
    description: "Read-only observability: open sessions and spill usage (records only, never dials).",
    usage: "status [--json]",
    run: status
  },
  {
    name: "inject",
    description: "Run JS in the session page; authoring door for custom tools (registers, probes, unpublished flows).",
    usage: `inject <handle> '<js>' [--timeout ms 1-${INVOKE_TIMEOUT_MAX_MS}] [--json]`,
    run: inject
  },
  {
    name: "skill",
    description: "Print the bundled agent skill (version-matched to this binary).",
    usage: "skill [show]",
    run: skill
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

export const dispatch = (argv: ReadonlyArray<string>): Effect.Effect<void, UsageError | CliFailure | Error> =>
  Effect.gen(function*() {
    const version = yield* getVersion
    const [name, ...rest] = argv
    if (name === undefined || name === "--help" || name === "-h") {
      yield* Console.log(helpText(version))
      return
    }
    if (name === "--version" || name === "-v") {
      yield* Console.log(version)
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
