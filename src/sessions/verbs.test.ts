import { beforeAll, afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliFailure } from "../failure.ts"
import { saveSession } from "./store.ts"
import type { SessionRecord } from "./store.ts"
import { normalizeOutput, statusSessions } from "./verbs.ts"

// L6 regression lock: consumption shape, not wire shape. Every case is a
// real envelope the transport has delivered (showcase) or a scalar the
// fixtures deliver — no invented wire formats.
describe("normalizeOutput", () => {
  test("structuredContent wins over content text", () => {
    const out = normalizeOutput({
      content: [{ type: "text", text: "{\"wrong\":true}" }],
      structuredContent: { count: 1, products: [{ id: "p" }] }
    })
    expect(out).toEqual({ count: 1, products: [{ id: "p" }] })
  })
  test("JSON text part parses", () => {
    expect(normalizeOutput({ content: [{ type: "text", text: "[{\"id\":\"F1\"}]" }] }))
      .toEqual([{ id: "F1" }])
  })
  test("non-JSON text part stays raw", () => {
    expect(normalizeOutput({ content: [{ type: "text", text: "rooms from H" }] }))
      .toBe("rooms from H")
  })
  test("scalars pass through untouched", () => {
    expect(normalizeOutput("[{\"id\":\"F1\"}]")).toBe("[{\"id\":\"F1\"}]")
    expect(normalizeOutput(42)).toBe(42)
    expect(normalizeOutput(undefined)).toBeUndefined()
  })
  test("malformed envelopes pass through, never throw", () => {
    expect(normalizeOutput({ content: [] })).toEqual({ content: [] })
    expect(normalizeOutput({ content: [{ nope: 1 }] })).toEqual({ content: [{ nope: 1 }] })
    expect(normalizeOutput(null)).toBeNull()
  })
})

// Isolated dirs: this suite never touches live sessions or live spill.
// Env overrides are test-harness setup (bun:test scaffolding), exempt
// from the Effect discipline law like store.test.ts.
const SESSIONS_TEST = mkdtempSync(join(tmpdir(), "awm-status-sessions-"))
const SPILL_TEST = mkdtempSync(join(tmpdir(), "awm-status-spill-"))
beforeAll(() => {
  process.env.AGENT_SESSIONS_DIR = SESSIONS_TEST
  process.env.AGENT_SPILL_DIR = SPILL_TEST
})
afterEach(() => {
  rmSync(SESSIONS_TEST, { recursive: true, force: true })
  rmSync(SPILL_TEST, { recursive: true, force: true })
  mkdirSync(SESSIONS_TEST, { recursive: true })
  mkdirSync(SPILL_TEST, { recursive: true })
})

const record = (handle: string, url: string, createdAt = "2026-10-09T00:00:00.000Z"): SessionRecord => ({
  handle,
  browserHttp: "http://localhost:9",
  targetId: "T",
  url,
  ownBrowser: false,
  createdAt
})

const runOk = <A>(effect: Effect.Effect<A, CliFailure>): Promise<A> => Effect.runPromise(effect)

describe("statusSessions", () => {
  test("empty world reads empty (records only, never dials)", async () => {
    const report = await runOk(statusSessions())
    expect(report.sessions).toEqual([])
    expect(report.spill).toEqual({ files: 0, bytes: 0 })
  })
  test("sessions list handle+url, spill counts files+bytes", async () => {
    await runOk(saveSession(record("s_stata", "https://a.test/", "2026-10-09T00:00:00.000Z")))
    await runOk(saveSession(record("s_statb", "https://b.test/", "2026-10-09T00:00:01.000Z")))
    writeFileSync(join(SPILL_TEST, "spill-x.txt"), "12345678")
    const report = await runOk(statusSessions())
    expect(report.sessions).toEqual([
      { handle: "s_stata", url: "https://a.test/" },
      { handle: "s_statb", url: "https://b.test/" }
    ])
    expect(report.spill).toEqual({ files: 1, bytes: 8 })
  })
})
