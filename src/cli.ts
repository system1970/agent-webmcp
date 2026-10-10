// CLI shape: parse is pure (unit-tested); effects live in commands/.
// Piped output defaults to JSON; --plain forces rows. Writes need --yes.
// Exits: 0 ok, 2 usage, 1 failure (message on stderr).
export interface CliArgs {
  readonly command: string
  readonly positionals: ReadonlyArray<string>
  readonly flags: Record<string, string | boolean>
}

export class UsageError {
  readonly _tag = "UsageError"
  constructor(readonly message: string) {}
}

const has = (flags: Record<string, string | boolean>, name: string): boolean =>
  flags[name] === true || flags[name] === "true"

const BOOLEAN_FLAGS = new Set(["json", "plain", "yes", "help", "version"])

export const parse = (argv: ReadonlyArray<string>): CliArgs | UsageError => {
  const positionals: Array<string> = []
  const flags: Record<string, string | boolean> = {}
  let command: string | null = null
  let i = 0
  while (i < argv.length) {
    const arg = argv[i] as string
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=")
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else if (!BOOLEAN_FLAGS.has(arg.slice(2)) && i + 1 < argv.length && !(argv[i + 1] as string).startsWith("--")) {
        flags[arg.slice(2)] = argv[i + 1] as string
        i++
      } else {
        flags[arg.slice(2)] = true
      }
    } else if (command === null) {
      command = arg
    } else {
      positionals.push(arg)
    }
    i++
  }
  if (command === null) {
    if (flags["help"] === true) return { command: "help", positionals, flags }
    if (flags["version"] === true) return { command: "version", positionals, flags }
    return new UsageError("no command (try --help)")
  }
  return { command, positionals, flags }
}

export const isJson = (args: CliArgs): boolean => {
  if (has(args.flags, "json")) return true
  if (has(args.flags, "plain")) return false
  return !process.stdout.isTTY
}

export const needYes = (args: CliArgs, command: string): UsageError | null =>
  has(args.flags, "yes") ? null : new UsageError(`${command} needs --yes (deliberate writes only)`)

export const USAGE = `agent-webmcp [--version | --help] <command> [args]

  doctor [--json]              environment report
  mcp (list [--json] | serve)  inspect the surface / serve over stdio
  open [--cdp URL] [--port N] [--json|--plain] <url>
  list <handle> [tool] [--json|--plain]
  close <handle|--all> --yes [--json|--plain]
  register <handle> '<json-tool>' '<js-body>' [--timeout ms] --yes
  unregister <handle> <name> --yes
  skill show                   print the bundled agent skill`
