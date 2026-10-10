// Composition root: parse (pure), provide layers once, run at the edge.
// Exactly one runPromiseExit. Exits: 0 ok, 2 usage, 1 failure.
import { Effect, Layer } from "effect"
import { parse, UsageError, USAGE, type CliArgs } from "./cli.ts"
import { cmdClose, cmdDoctor, cmdList, cmdOpen, cmdRegister, cmdUnregister } from "./commands/verbs.ts"
import { SKILL_MD } from "./generated/skill.ts"
import { cmdMcpList, cmdMcpServe } from "./commands/serve.ts"
import { Browser } from "./sessions/sessions.ts"
import { SessionStore } from "./sessions/store.ts"
import { SESSION_ROOT } from "./sessions/sessions.ts"
import { cliVersion } from "./version.ts"

const layers = Layer.mergeAll(SessionStore.Disk(SESSION_ROOT), Browser.Live)

const dispatch = (args: CliArgs): Effect.Effect<number, never> =>
  Effect.gen(function* () {
    switch (args.command) {
      case "--help":
      case "help":
        console.log(USAGE)
        return 0
      case "--version":
      case "version":
        console.log(cliVersion)
        return 0
      case "doctor":
        yield* cmdDoctor()
        return 0
      case "open":
        yield* Effect.provide(cmdOpen(args), layers)
        return 0
      case "list":
        yield* Effect.provide(cmdList(args), layers)
        return 0
      case "close":
        yield* Effect.provide(cmdClose(args), layers)
        return 0
      case "register":
        yield* Effect.provide(cmdRegister(args), layers)
        return 0
      case "unregister":
        yield* Effect.provide(cmdUnregister(args), layers)
        return 0
      case "skill":
        if (args.positionals[0] === "show") {
          console.log(SKILL_MD.trimEnd())
          return 0
        }
        console.error(`unknown skill command (try: skill show)\n\n${USAGE}`)
        return 2
      case "mcp":
        if (args.positionals[0] === "serve") {
          yield* cmdMcpServe(layers)
          return 0
        }
        yield* cmdMcpList()
        return 0
      default:
        console.error(`unknown command: ${args.command}\n\n${USAGE}`)
        return 2
    }
  }).pipe(
    Effect.catchTag("UsageError", (err) => {
      console.error(`usage: ${err.message}\n\n${USAGE}`)
      return Effect.succeed(2)
    }),
    Effect.catchCause((cause) => {
      console.error(`error: ${String(cause).split("\n")[0]?.slice(0, 300) ?? cause}`)
      return Effect.succeed(1)
    })
  )

const main = Effect.fn("main")(function* () {
  const parsed = parse(Bun.argv.slice(2))
  if (parsed instanceof UsageError) {
    console.error(`usage: ${parsed.message}\n\n${USAGE}`)
    return 2
  }
  return yield* dispatch(parsed)
})

const exit = await Effect.runPromiseExit(main())
if (exit._tag === "Failure") {
  console.error("defect: run failed outside the error channel")
  process.exit(1)
}
process.exit(exit.value)
