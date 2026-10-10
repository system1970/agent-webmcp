// Launch: a Chromium we own. Headless, remote debugging on, WebMCP
// testing flags on (no-op where WebMCP ships, required on http/localhost
// where the surface stays undefined without them). Floor: Chromium 152.
import { Duration, Effect } from "effect"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { TransportFailed } from "./errors.ts"

export const CHROMIUM_FLOOR = 152
const WEBMCP_FLAGS = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport"
const PORT_MIN = 1024
const PORT_MAX = 65535

export interface Launched {
  readonly httpEndpoint: string
  readonly pid: number
  readonly port: number
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

export const launchChromium = Effect.fn("transport.launchChromium")(function* (port = 9333) {
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
  const userDataDir = `${tmpdir()}/agent-webmcp-chrome-${port}`
  const proc = Bun.spawn([exe, "--headless", `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, "--no-first-run", "--no-default-browser-check", WEBMCP_FLAGS, "about:blank"], {
    stdout: "ignore",
    stderr: "ignore",
  })
  const httpEndpoint = `http://127.0.0.1:${port}`
  const onTimeout = Effect.fail(
    new TransportFailed({
      reason: "timeout",
      operation: "launch",
      message: `browser on ${port} never answered /json/version`,
      fix: "is the port free? is this chromium new enough for --headless=new?",
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
      }).pipe(Effect.andThen(onTimeout))
    )
  )
  return {
    httpEndpoint,
    pid: proc.pid,
    port,
    close: Effect.sync(() => {
      try {
        proc.kill()
      } catch {
        // Best-effort: a dead browser needs no killing.
      }
      try {
        rmSync(userDataDir, { recursive: true, force: true })
      } catch {
        // Best-effort: temp dirs die with /tmp anyway.
      }
    }),
  } satisfies Launched
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
