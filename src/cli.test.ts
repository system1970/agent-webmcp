// CLI tests: parse is pure — every shape pinned, no processes spawned.
import { describe, expect, test } from "bun:test"
import { isJson, parse, UsageError } from "./cli.ts"

describe("cli", () => {
  test("command + positionals + flags", () => {
    const out = parse(["open", "https://x.test", "--cdp", "http://h:1", "--yes"])
    expect(out).toEqual({ command: "open", positionals: ["https://x.test"], flags: { cdp: "http://h:1", yes: true } })
  })

  test("flag=value form", () => {
    const out = parse(["register", "--timeout=5000", "h", "{}", "code", "--yes"])
    expect(out).toEqual({
      command: "register",
      positionals: ["h", "{}", "code"],
      flags: { timeout: "5000", yes: true },
    })
  })

  test("no command is a usage error", () => {
    const out = parse(["--json"])
    expect(out).toBeInstanceOf(UsageError)
  })

  test("--help and --version become commands", () => {
    expect(parse(["--help"])).toEqual({ command: "help", positionals: [], flags: { help: true } })
    expect(parse(["--version"])).toEqual({ command: "version", positionals: [], flags: { version: true } })
  })

  test("json default follows the pipe", () => {
    expect(isJson({ command: "list", positionals: [], flags: { json: true } })).toBe(true)
    expect(isJson({ command: "list", positionals: [], flags: { plain: true } })).toBe(false)
  })
})
