import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { rmSync } from "node:fs"
import { CliFailure } from "../failure.ts"
import { listSessions, loadSession, newHandle, removeSession, saveSession } from "./store.ts"
import type { SessionRecord } from "./store.ts"

// Isolated dir: this suite must never touch (or wipe) live sessions.
// Raw IO in beforeAll/afterEach is test-harness setup, exempt from the
// Effect discipline law (which binds src/, not bun:test scaffolding).
const TEST_DIR = "/tmp/opencode/agent-webmcp-sessions-test"
beforeAll(() => {
  process.env.AGENT_SESSIONS_DIR = TEST_DIR
  rmSync(TEST_DIR, { recursive: true, force: true })
})

const record = (handle: string): SessionRecord => ({
  handle,
  browserHttp: "http://localhost:9",
  targetId: "T",
  url: "https://webmcp.test/session",
  ownBrowser: false,
  createdAt: "2026-10-08T00:00:00.000Z"
})

const runOk = <A>(effect: Effect.Effect<A, CliFailure>): Promise<A> => Effect.runPromise(effect)

const runErr = (effect: Effect.Effect<unknown, CliFailure>): Promise<CliFailure> =>
  Effect.runPromise(Effect.flip(effect))

afterEach(async () => {
  for (const s of await runOk(listSessions())) await runOk(removeSession(s.handle))
})

describe("sessions", () => {
  test("newHandle is opaque and unique", async () => {
    const a = await Effect.runPromise(newHandle)
    const b = await Effect.runPromise(newHandle)
    expect(a).toMatch(/^s_[a-z0-9]+$/)
    expect(a).not.toBe(b)
  })

  test("save then load round-trips", async () => {
    await runOk(saveSession(record("s_test1")))
    const loaded = await runOk(loadSession("s_test1"))
    expect(loaded.url).toBe("https://webmcp.test/session")
    expect(loaded.targetId).toBe("T")
  })

  test("unknown handle names the fix", async () => {
    const failure = await runErr(loadSession("s_nope"))
    expect(failure).toBeInstanceOf(CliFailure)
    expect(failure.message).toContain("unknown session 's_nope'")
  })

  test("path traversal handles are refused, never resolved", async () => {
    const failure = await runErr(loadSession("../../x"))
    expect(failure.message).toContain("invalid session handle")
    const removed = await runErr(removeSession("../../x"))
    expect(removed.message).toContain("invalid session handle")
  })

  test("remove drops the record", async () => {
    await runOk(saveSession(record("s_test2")))
    await runOk(removeSession("s_test2"))
    const failure = await runErr(loadSession("s_test2"))
    expect(failure.message).toContain("unknown session 's_test2'")
  })

  test("listSessions only sees its own dir", async () => {
    await runOk(saveSession(record("s_test3")))
    const all = await runOk(listSessions())
    expect(all.map((s) => s.handle)).toEqual(["s_test3"])
  })
})
