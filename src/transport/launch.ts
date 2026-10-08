import { Duration, Effect } from "effect"
import { rmSync } from "node:fs"
import { TransportFailed } from "./errors.ts"

// Launch a Chromium we own: headless, remote debugging on, WebMCP flags on.
// Returns the browser HTTP endpoint (for /json/*) plus close. The caller
// derives ws endpoints from /json/version or /json/list.
export interface Launched {
  readonly httpEndpoint: string
  readonly close: Effect.Effect<void>
}

const findExecutable = Effect.fn("transport.findExecutable")(function* () {
  const candidates = ["chromium", "google-chrome", "google-chrome-stable"]
  for (const bin of candidates) {
    const proc = Bun.spawnSync(["which", bin])
    const out = yield* Effect.sync(() => Buffer.from(proc.stdout).toString("utf8")).pipe(
      Effect.mapError(() => new TransportFailed({
        reason: "no-browser",
        operation: "launch",
        message: "PATH lookup itself failed",
        fix: "set CHROMIUM_PATH to the binary directly."
      }))
    )
    const path = out.trim().split("\n")[0]?.trim() ?? ""
    if (path !== "") return path
  }
  return yield* Effect.fail(new TransportFailed({
    reason: "no-browser",
    operation: "launch",
    message: "no chromium executable on PATH (tried chromium, google-chrome, google-chrome-stable)",
    fix: "install chromium, or set CHROMIUM_PATH to the binary."
  }))
})

export const launchChromium = Effect.fn("transport.launchChromium")(function* (
  port = 9333
) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return yield* Effect.fail(new TransportFailed({
      reason: "no-browser",
      operation: "launch",
      message: `refusing to launch on port ${port}: want an integer in 1024-65535`,
      fix: "pass a free unprivileged port explicitly."
    }))
  }
  const fromEnv = yield* Effect.sync(() => Bun.env.CHROMIUM_PATH)
  const exe = fromEnv !== undefined && fromEnv !== ""
    ? fromEnv
    : yield* findExecutable()
  const userDataDir = `/tmp/opencode/agent-webmcp-chrome-${port}`
  // No feature flags: WebMCP ships in the browser, not behind a switch.
  // A build that needs flags is below the floor (see webmcpFloorFix).
  const args = [
    "--headless",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ]
  const proc = yield* Effect.sync(() => Bun.spawn([exe, ...args], {
    stdout: "ignore",
    stderr: "pipe"
  }))
  const httpEndpoint = `http://localhost:${port}`
  const kill = Effect.sync(() => {
    try {
      // SIGKILL, not SIGTERM: eval browsers hold temp profiles and must
      // never outlive the run to steal the next run's port. The profile
      // dir is removed too — retention would accumulate per-port dirs.
      proc.kill("SIGKILL")
    } catch {}
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {}
  })
  // Wait until the DevTools HTTP endpoint answers, or fail loudly. Polling
  // beats parsing stderr: no log scraping, no format to rot.
  const deadline = yield* Effect.sync(() => Date.now() + 10000)
  for (;;) {
    const up = yield* Effect.tryPromise(
      () => fetch(`${httpEndpoint}/json/version`).then((res) => res.ok)
    ).pipe(Effect.catch(() => Effect.succeed(false)))
    if (up) return { httpEndpoint, close: kill }
    const now = yield* Effect.sync(() => Date.now())
    if (now > deadline) {
      // No raw timers: the stderr drain races the read against a timeout,
      // both inside the runtime.
      const stderr = yield* Effect.tryPromise(
        () => new Response(proc.stderr).text()
      ).pipe(
        Effect.timeout(Duration.millis(1000)),
        Effect.catch(() => Effect.succeed(""))
      )
      yield* kill
      return yield* Effect.fail(new TransportFailed({
        reason: "no-browser",
        operation: "launch",
        message: `${exe} started but /json/version never answered on ${port}` +
          (stderr.trim() !== "" ? ` :: browser stderr: ${stderr.trim().slice(0, 500)}` : ""),
        fix: `is port ${port} already taken? Pass another port.`
      }))
    }
    yield* Effect.sleep(Duration.millis(100))
  }
})
