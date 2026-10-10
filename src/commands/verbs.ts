// CLI doors: argv into verb calls. Output to stdout (JSON piped, rows on
// TTY); failures are values for main to exit on. Layers provided once,
// in main — never here.
import { Effect } from "effect"
import { close } from "../tools/close.ts"
import { list } from "../tools/list.ts"
import { open } from "../tools/open.ts"
import { register } from "../tools/register.ts"
import { unregister } from "../tools/unregister.ts"
import { isJson, needYes, UsageError, type CliArgs } from "../cli.ts"
import type { VerbError, VerbServices } from "../tools/definition.ts"
import { effectVersion } from "../version.ts"

type Door = Effect.Effect<void, VerbError | UsageError, VerbServices>

const print = (args: CliArgs, content: string, rows?: (parsed: unknown) => string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (isJson(args)) {
      console.log(content)
      return
    }
    if (rows === undefined) {
      console.log(content)
      return
    }
    try {
      console.log(rows(JSON.parse(content) as unknown))
    } catch {
      console.log(content)
    }
  })

const shape = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value))

export const cmdOpen = (args: CliArgs): Door =>
  Effect.gen(function* () {
    const url = args.positionals[0]
    if (url === undefined) return yield* Effect.fail(new UsageError("open needs <url>"))
    const cdp = args.flags["cdp"]
    const port = args.flags["port"]
    const headed = args.flags["headed"]
    const result = yield* open.execute(
      {
        url,
        ...(typeof cdp === "string" ? { cdp } : {}),
        ...(typeof port === "string" ? { port: Number(port) } : {}),
        ...(headed === true ? { headed: true } : {}),
      },
      {}
    )
    yield* print(args, result.content, (parsed) => {
      const r = parsed as { handle?: unknown; url?: unknown; toolCount?: unknown }
      return `${String(r.handle)}  ${String(r.url)}  (${String(r.toolCount)} tools)`
    })
  })

export const cmdList = (args: CliArgs): Door =>
  Effect.gen(function* () {
    const handle = args.positionals[0]
    if (handle === undefined) return yield* Effect.fail(new UsageError("list needs <handle>"))
    const tool = args.positionals[1]
    const result = yield* list.execute({ handle, ...(tool !== undefined ? { tool } : {}) }, {})
    yield* print(args, result.content, (parsed) => {
      if (!Array.isArray(parsed)) return shape(parsed)
      return (parsed as Array<{ name?: unknown; description?: unknown }>)
        .map((t) => `${String(t.name)} — ${String(t.description ?? "")}`)
        .join("\n")
    })
  })

export const cmdClose = (args: CliArgs): Door =>
  Effect.gen(function* () {
    const gated = needYes(args, "close")
    if (gated !== null) return yield* Effect.fail(gated)
    const target = args.positionals[0]
    if (target === undefined) return yield* Effect.fail(new UsageError("close needs <handle|--all>"))
    const result = yield* close.execute(target === "--all" ? { all: true } : { handle: target }, {})
    yield* print(args, result.content)
  })

export const cmdRegister = (args: CliArgs): Door =>
  Effect.gen(function* () {
    const gated = needYes(args, "register")
    if (gated !== null) return yield* Effect.fail(gated)
    const [handle, toolJson, code] = args.positionals
    if (handle === undefined || toolJson === undefined || code === undefined) {
      return yield* Effect.fail(new UsageError("register needs <handle> '<json-tool>' '<js-body>'"))
    }
    let tool: unknown
    try {
      tool = JSON.parse(toolJson) as unknown
    } catch {
      return yield* Effect.fail(new UsageError("register: <json-tool> is not JSON"))
    }
    const timeout = args.flags["timeout"]
    const result = yield* register.execute(
      { handle, tool, code, ...(typeof timeout === "string" ? { timeoutMs: Number(timeout) } : {}) },
      {}
    )
    yield* print(args, result.content)
  })

export const cmdUnregister = (args: CliArgs): Door =>
  Effect.gen(function* () {
    const gated = needYes(args, "unregister")
    if (gated !== null) return yield* Effect.fail(gated)
    const [handle, name] = args.positionals
    if (handle === undefined || name === undefined) {
      return yield* Effect.fail(new UsageError("unregister needs <handle> <name>"))
    }
    const result = yield* unregister.execute({ handle, name }, {})
    yield* print(args, result.content)
  })

export const cmdDoctor = (): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(
      JSON.stringify(
        { bun: Bun.version, platform: `${process.platform}/${process.arch}`, effect: effectVersion },
        null,
        2
      )
    )
  })
