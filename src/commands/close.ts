import { Console, Effect } from "effect"
import { rmSync, readlinkSync } from "node:fs"
import { closePage, dial } from "../transport/client.ts"
import { browserWs } from "../transport/devtools.ts"
import { listSessions, loadSession, removeSession } from "../sessions/store.ts"
import type { SessionRecord } from "../sessions/store.ts"
import { UsageError, CliFailure, asCliFailure } from "./failure.ts"

// close <handle|--all>: release the page; kill browsers we launched (never
// foreign ones). A dead browser is not an error: the record still goes.
export const close = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const [target, extra] = args
    if (target === undefined || extra !== undefined || (target.startsWith("-") && target !== "--all")) {
      return yield* Effect.fail(new UsageError({ message: "close: Usage: close <handle|--all>" }))
    }
    if (target === "--all") {
      const sessions = yield* listSessions()
      let failed = 0
      for (const record of sessions) {
        // Operational failures only (CliFailure — closeOne already maps
        // TransportFailed at its boundary): a defect here means the
        // runtime itself is wedged — let it die with a dump, never
        // convert to a tidy per-record line.
        const ok = yield* closeOne(record.handle).pipe(
          Effect.as(true),
          Effect.catchTag("CliFailure", () => Effect.succeed(false))
        )
        if (!ok) {
          failed++
          yield* Console.log(`close --all: '${record.handle}' failed (record kept, retry or drop the file)`)
        }
      }
      yield* Console.log(`closed ${sessions.length - failed}/${sessions.length} session(s)`)
      if (failed > 0) {
        return yield* Effect.fail(new CliFailure({ message: `close --all: ${failed} session(s) failed (see lines above)` }))
      }
      return yield* Effect.void
    }
    yield* closeOne(target)
    yield* Console.log(`closed ${target}`)
  })

const closeOne = Effect.fn("close.one")(function* (handle: string) {
  const record = yield* loadSession(handle)
  // Dead browsers are not errors — but only dead ones. Anything else
  // (protocol, timeout) fails loud AFTER local cleanup, so a wedged
  // browser never holds the record hostage while still reporting truth.
  yield* browserWs(record.browserHttp).pipe(
    Effect.flatMap((ws) => Effect.gen(function* () {
      const conn = yield* dial(ws)
      yield* Effect.ensuring(closePage(conn, record.targetId), conn.close)
    })),
    Effect.catchTag("TransportFailed", (f) =>
      f.reason === "no-browser" || f.reason === "navigated"
        ? Effect.void
        : Effect.fail(f))
  ).pipe(
    Effect.catch((f) => cleanupLocal(record).pipe(
      Effect.andThen(() => removeSession(handle)),
      Effect.andThen(() => Effect.fail(f))
    )),
    // Middle lane: TransportFailed leaves here as a clean CliFailure
    // (open/list/invoke all map the same way). Defects still die loud.
    Effect.catchTag("TransportFailed", (f) => Effect.fail(asCliFailure(f)))
  )
  yield* cleanupLocal(record)
  yield* removeSession(handle)
})

const cleanupLocal = Effect.fn("close.local")(function* (record: SessionRecord) {
  if (!record.ownBrowser) return
  const pid = record.pid
  // Never kill a number from disk unverified: confirm /proc/<pid> is
  // OUR chromium before SIGKILL. argv is faker-friendly, so the check is
  // the exe symlink (the running binary, unfakeable) plus our profile-dir
  // marker in argv. A planted record otherwise turns close into
  // kill-an-arbitrary-pid.
  if (pid !== undefined && record.port !== undefined) {
    const marker = `agent-webmcp-chrome-${record.port}`
    const verified = yield* Effect.tryPromise(async () => {
      const exe = readlinkSync(`/proc/${pid}/exe`)
      const cmd = await Bun.file(`/proc/${pid}/cmdline`).text()
      return exe.includes("chromium") && cmd.includes(marker)
    }).pipe(Effect.catch(() => Effect.succeed(false)))
    if (verified) {
      yield* Effect.sync(() => {
        try {
          process.kill(pid, "SIGKILL")
        } catch {}
      })
    }
    const dir = `/tmp/opencode/agent-webmcp-chrome-${record.port}`
    yield* Effect.sync(() => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {}
    })
  }
})
