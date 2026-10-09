import { Console, Effect } from "effect"
import { CliFailure, TransientFailure, UsageError } from "./failure.ts"
import { doctor } from "./commands/doctor.ts"
import { mcpList } from "./commands/mcp-list.ts"
import { mcpServe } from "./commands/mcp-serve.ts"
import { open } from "./commands/open.ts"
import { list } from "./commands/list.ts"
import { close } from "./commands/close.ts"
import { search } from "./commands/search.ts"
import { execute } from "./commands/execute.ts"
import { register } from "./commands/register.ts"
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
  readonly run: (args: ReadonlyArray<string>) => Effect.Effect<void, UsageError | CliFailure | TransientFailure | Error>
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
    usage: "open [--cdp URL [--target SUB]] [--port N] [--json|--plain] <url>",
    run: open
  },
  {
    name: "list",
    description: "Show a session's page tools (stat-like rows; full schema on demand).",
    usage: "list <handle> [tool] [--json|--plain]",
    run: list
  },
  {
    name: "close",
    description: "Release a session (kills browsers we launched, never foreign ones). Needs --yes.",
    usage: "close <handle|--all> [--yes] [--json|--plain]",
    run: close
  },
  {
    name: "search",
    description: "Find tools by words (engine + session page tools with --handle/--all).",
    usage: "search [--json|--plain] [--handle H ...] [--all] [--limit 1–50] <query...>",
    run: search
  },
  {
    name: "execute",
    description: "Run JS code against session page tools, one turn per flow (single --session, --handle aliases it; multi: repeat --as ALIAS=H). Accident-contained, runs with your privilege.",
    usage: `execute [--session H | --as ALIAS=H ...] [--timeout ms 1-${RUN_TIMEOUT_MAX_MS}] [--max-chars N] [--json|--plain] '<code>'`,
    run: execute
  },
  {
    name: "register",
    description: "Author a custom tool onto the session page (spec-shaped: name/title/description/schema/annotations + code body). Needs --yes.",
    usage: `register <handle> '<json-tool>' '<js-body>' [--timeout ms 1-${INVOKE_TIMEOUT_MAX_MS}] [--yes] [--json|--plain]`,
    run: register
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

export const dispatch = (argv: ReadonlyArray<string>): Effect.Effect<void, UsageError | CliFailure | TransientFailure | Error> =>
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
