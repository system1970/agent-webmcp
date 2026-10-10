// Launch: a Chromium we own. Headless, remote debugging on, WebMCP
// testing flags on (no-op where WebMCP ships, required on http/localhost
// where the surface stays undefined without them). Floor: Chromium 152.
import { Duration, Effect } from "effect"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { TransportFailed } from "./errors.ts"

export const CHROMIUM_FLOOR = 152
const WEBMCP_FLAGS = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport"
// Never show the crash bubble for automation-owned profiles (clean
// shutdown below is the real fix; this is backup for kills from outside,
// e.g. OOM or a stray pkill — throwaway profiles have nothing to restore).
const QUIET_FLAGS = ["--disable-session-crashed-bubble", "--disable-infobars"]
// Deterministic viewport in both modes (a WM-decided viewport once hid
// an entire chat UI at 621px — responsive layout must never be ambient).
const VIEWPORT_FLAGS = ["--window-size=1400,950", "--force-device-scale-factor=1"]
const PORT_MIN = 1024
const PORT_MAX = 65535

export interface Launched {
  readonly httpEndpoint: string
  readonly pid: number
  readonly port: number
  readonly profileDir: string
  readonly close: Effect.Effect<void>
}

const findExecutable = Effect.fn("transport.findExecutable")(function* () {
  const fromEnv = Bun.env.CHROMIUM_PATH
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv
  for (const bin of ["chromium", "google-chrome", "google-chrome-stable"]) {
    const proc = Bun.spawnSync(["which", bin])
    if (proc.exitCode !== 0) continue
    const path = new TextDecoder().decode(proc.stdout).trim().split("\n")[0]?.trim() ?? ""
    if (path !== "") return path
  }
  return yield* Effect.fail(
    new TransportFailed({
      reason: "no-browser",
      operation: "launch",
      message: "no chromium executable on PATH (tried chromium, google-chrome, google-chrome-stable)",
      fix: "install chromium, or set CHROMIUM_PATH to the binary.",
    })
  )
})

export interface LaunchOptions {
  readonly headed?: boolean
}

// Pure flag construction (unit-tested, no spawn): headed omits
// --headless and hints ozone (Wayland/X11 both work); headless is the
// default (CI-safe, no display needed).
export const buildArgs = (options: {
  port: number
  userDataDir: string
  headed: boolean
}): ReadonlyArray<string> => [
  ...(options.headed ? [] : ["--headless"]),
  `--remote-debugging-port=${options.port}`,
  `--user-data-dir=${options.userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  ...(options.headed ? ["--ozone-platform-hint=auto"] : []),
  WEBMCP_FLAGS,
  ...QUIET_FLAGS,
  ...VIEWPORT_FLAGS,
  "about:blank",
]

export const launchChromium = Effect.fn("transport.launchChromium")(function* (
  port = 9333,
  options: LaunchOptions = {}
) {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    return yield* Effect.fail(
      new TransportFailed({
        reason: "no-browser",
        operation: "launch",
        message: `refusing port ${port}: want an integer in ${PORT_MIN}-${PORT_MAX}`,
        fix: "pass a free unprivileged port explicitly.",
      })
    )
  }
  const exe = yield* findExecutable()
  const headed = options.headed === true
  const userDataDir = `${tmpdir()}/agent-webmcp-chrome-${port}`
  const proc = Bun.spawn([exe, ...buildArgs({ port, userDataDir, headed })], {
    stdout: "ignore",
    stderr: "ignore",
  })
  const httpEndpoint = `http://127.0.0.1:${port}`
  const onTimeout = Effect.fail(
    new TransportFailed({
      reason: "timeout",
      operation: "launch",
      message: `browser on ${port} never answered /json/version`,
      fix: headed
        ? "headed needs a display (no $DISPLAY/Wayland socket?) — use Xvfb or drop --headed."
        : "is the port free? is this chromium new enough?",
    })
  )
  yield* Effect.tryPromise({
    try: () => pollVersion(httpEndpoint),
    catch: (err) =>
      err instanceof TransportFailed
        ? err
        : new TransportFailed({ reason: "connect", operation: "launch", message: String(err), fix: "see above." }),
  }).pipe(
    Effect.timeout(Duration.millis(15000)),
    Effect.catchTag("TimeoutError", () =>
      Effect.sync(() => {
        try {
          proc.kill()
        } catch {
          // Already gone — the timeout is the news, not the kill.
        }
        try {
          rmSync(userDataDir, { recursive: true, force: true })
        } catch {
          // Timeout path must not leave a dirty profile behind either.
        }
      }).pipe(Effect.andThen(onTimeout))
    )
  )
  return {
    httpEndpoint,
    pid: proc.pid,
    port,
    profileDir: userDataDir,
    close: shutdown(proc.pid, userDataDir),
  } satisfies Launched
})

// Graceful shutdown: SIGTERM lets Chromium write clean profile state
// (a SIGKILL'd profile offers "Restore pages?" on next launch — the
// exact dialog users reported). Escalate to SIGKILL past 3s, then
// remove the profile dir on every path. Close never fails.
export const shutdown = (pid: number, profileDir: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    try {
      process.kill(pid)
    } catch {
      // Already dead — removal below still happens.
    }
    const gone = yield* Effect.promise(() => waitGone(pid, 3000))
    if (!gone) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // Died between check and signal — fine.
      }
    }
    try {
      rmSync(profileDir, { recursive: true, force: true })
    } catch {
      // Best-effort: temp dirs die with the OS temp anyway.
    }
  }).pipe(Effect.orElseSucceed(() => undefined))

const waitGone = (pid: number, budgetMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const start = Date.now()
    const tick = (): void => {
      try {
        process.kill(pid, 0)
      } catch {
        resolve(true)
        return
      }
      if (Date.now() - start >= budgetMs) resolve(false)
      else setTimeout(tick, 100)
    }
    tick()
  })

const pollVersion = async (httpEndpoint: string): Promise<void> => {
  for (;;) {
    try {
      const res = await fetch(`${httpEndpoint}/json/version`)
      if (res.ok) return
    } catch {
      // Not up yet — sleep below, timeout above owns the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
