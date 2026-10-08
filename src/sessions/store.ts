import { Console, Effect, Schema } from "effect"
import { mkdirSync, chmodSync } from "node:fs"
import { CliFailure } from "../commands/failure.ts"

// Persisted sessions: re-attachable handles, not live sockets. A CLI
// invocation is one process; the browser outlives it. Each record holds
// everything a later invocation needs to dial the browser and reattach
// the target. Lives under /tmp: browsers die on reboot, so records must
// never outlive the machine — tmp cleans itself.
export const SESSIONS_DIR = "/tmp/opencode/agent-webmcp-sessions"

export const SessionRecord = Schema.Struct({
  handle: Schema.String,
  browserHttp: Schema.String,
  targetId: Schema.String,
  url: Schema.String,
  ownBrowser: Schema.Boolean,
  pid: Schema.optional(Schema.Number),
  port: Schema.optional(Schema.Number),
  createdAt: Schema.String
})
export type SessionRecord = typeof SessionRecord.Type

// Handles and timestamps are impure (clock + randomness): Effects, so
// tests and replays can pin them. Production callers yield*; tests use
// fixed handles and never touch this. crypto randomness (not Math) +
// 0700 dir: session records in shared /tmp must be neither guessable
// nor enumerable by other local users.
export const newHandle = Effect.sync((): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  return `s_${[...bytes].map((b) => alphabet[b % 36]).join("")}`
})

export const nowIso = Effect.sync((): string => new Date().toISOString())

// Isolated in tests via AGENT_SESSIONS_DIR (see store.test.ts); production
// uses /tmp, which dies on reboot along with the browsers.
export const sessionsDir = (): string => Bun.env.AGENT_SESSIONS_DIR ?? SESSIONS_DIR

const pathFor = (handle: string): string => `${sessionsDir()}/${handle}.json`

const HANDLE_PATTERN = /^s_[a-z0-9]+$/

const checkHandle = Effect.fn("sessions.checkHandle")(function* (handle: string) {
  // Jail the record dir: handles are ours (s_+base36), but argv is not.
  if (!HANDLE_PATTERN.test(handle)) {
    return yield* Effect.fail(new CliFailure({
      message: `invalid session handle '${handle}': want s_... (handles come from \`open\`)`
    }))
  }
})

export const saveSession = Effect.fn("sessions.save")(function* (record: SessionRecord) {
  yield* Effect.sync(() => {
    mkdirSync(sessionsDir(), { recursive: true, mode: 0o700 })
    chmodSync(sessionsDir(), 0o700)
  })
  yield* Effect.tryPromise({
    try: () => Bun.write(pathFor(record.handle), JSON.stringify(record, null, 2)),
    catch: (cause) => new CliFailure({ message: `cannot persist session: ${String(cause)}` })
  })
})

export const listSessions = Effect.fn("sessions.list")(function* () {
  // Bun.Glob.scan is async-iterable: read all files inside one promise
  // boundary (decode stays in-Effect below). Corrupt files skip here
  // (counted + logged) but fail loud in loadSession: listing tolerates
  // rot, acting on a record must not.
  let skipped = 0
  const raws = yield* Effect.tryPromise(
    async () => {
      const out: Array<unknown> = []
      const glob = new Bun.Glob("s_*.json")
      for await (const file of glob.scan({ cwd: sessionsDir(), absolute: true })) {
        try {
          out.push(await Bun.file(file).json())
        } catch {}
      }
      return out
    }
  ).pipe(Effect.catch((cause) => {
    // No dir yet (first run) reads as empty; real I/O failures stay loud.
    // The system error hides inside UnknownError.cause — match the numeric
    // code there, never the message text.
    const code = (cause as { cause?: { code?: unknown } }).cause?.code
    if (code === "ENOENT") return Effect.succeed([])
    return Effect.fail(new CliFailure({
      message: `cannot read session dir ${sessionsDir()}: ${String(cause)}`
    }))
  }))
  const records: Array<SessionRecord> = []
  for (const raw of raws) {
    try {
      records.push(Schema.decodeUnknownSync(SessionRecord)(raw))
    } catch {
      skipped++
    }
  }
  if (skipped > 0) {
    yield* Console.log(`sessions: skipped ${skipped} corrupt record(s) (load fails loud on access)`)
  }
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
})

export const loadSession = Effect.fn("sessions.load")(function* (handle: string) {
  yield* checkHandle(handle)
  // exists() resolving false means missing; rejecting means I/O failure
  // (EACCES etc.) — never coerce the latter into "unknown session".
  const exists = yield* Effect.tryPromise(
    () => Bun.file(pathFor(handle)).exists()
  ).pipe(Effect.mapError((cause) => new CliFailure({
    message: `cannot stat session '${handle}': ${String(cause)}`
  })))
  if (!exists) {
    const known = yield* listSessions().pipe(Effect.catch(() => Effect.succeed([] as Array<SessionRecord>)))
    return yield* Effect.fail(new CliFailure({
      message: `unknown session '${handle}'` +
        (known.length > 0
          ? ` (open sessions: ${known.map((s) => `${s.handle} ${s.url}`).join(", ")})`
          : " (no sessions open: run `open <url>` first)")
    }))
  }
  const raw = yield* Effect.tryPromise({
    try: () => Bun.file(pathFor(handle)).json(),
    catch: (cause) => new CliFailure({ message: `cannot read session '${handle}': ${String(cause)}` })
  })
  return yield* Schema.decodeUnknownEffect(SessionRecord)(raw).pipe(
    Effect.mapError(() => new CliFailure({ message: `session file '${handle}' is corrupt: delete it and open again.` }))
  )
})

export const removeSession = Effect.fn("sessions.remove")(function* (handle: string) {
  yield* checkHandle(handle)
  // Removal failure is real: claiming `closed` while the record survives
  // would resurrect the session on the next command.
  yield* Effect.tryPromise(
    () => Bun.file(pathFor(handle)).delete()
  ).pipe(Effect.mapError((cause) => new CliFailure({
    message: `cannot drop session '${handle}': ${String(cause)}`
  })))
})
