import { Effect } from "effect"
import { mkdirSync, chmodSync, openSync, writeSync, closeSync, readdirSync, statSync } from "node:fs"

// Overflow spill: results past budget keep their full body on disk and
// return a pointer, never a silent cut. (Canonical note: truncation
// destroys evidence; forged in-text markers are a prompt-injection
// vector, so the path travels as structured data — callers reference
// this file, not their own essays.)
export const spillDir = (): string => Bun.env.AGENT_SPILL_DIR ?? "/tmp/opencode/agent-webmcp-spill"

export interface ShapedResult {
  readonly text: string
  readonly spilled: string | null
}

// Clamp to budget; spill the full body when clamped. Returns text ready
// to embed plus the spill path (null when everything fit). Failure
// channel is UnknownError by design — callers map it into their own lane
// (ToolFailed/CliFailure), because spill is shared and owns no lane.
export const shapeResult = Effect.fn("spill.shape")(function* (
  content: string,
  maxChars: number | undefined,
  budget: { min: number; max: number; fallback: number }
) {
  const clamped = Math.min(budget.max, Math.max(budget.min, maxChars ?? budget.fallback))
  if (content.length <= clamped) return { text: content, spilled: null } as ShapedResult
  const dir = yield* Effect.sync(() => spillDir())
  if (dir === "" || !dir.startsWith("/")) {
    return yield* Effect.fail(new Error(`spill misconfigured: refusing dir '${dir}' (want absolute path)`))
  }
  yield* Effect.try(() => ensureDir(dir)).pipe(
    Effect.mapError((cause) => new Error(`spill dir failed for '${dir}': ${String(cause)}`))
  )
  const path = yield* Effect.try(() => writeExclusive(dir, content)).pipe(
    Effect.mapError((cause) => new Error(`spill write failed: ${String(cause)}`))
  )
  return {
    text: content.slice(0, clamped) + `\n…[truncated at ${clamped} chars; full body: ${path}]`,
    spilled: path
  } as ShapedResult
})

// Parents are operator trust (/tmp/opencode by default, created by our
// own session saves): only the leaf we create gets chmodded, never
// pre-existing parents. Throws on unexpected errors.
const ensureDir = (dir: string): void => {
  let created = false
  try {
    mkdirSync(dir)
    created = true
  } catch (e: unknown) {
    const code = (e as { code?: unknown }).code
    if (code !== "EEXIST" && code !== "ENOENT") throw e
    if (code === "ENOENT") {
      mkdirSync(dir, { recursive: true })
      created = true
    }
  }
  if (created) chmodSync(dir, 0o700)
}

// Exclusive 0600 create with retries: O_EXCL means a colliding name (or a
// planted symlink) fails instead of overwriting. 96-bit hex names make
// collision impractical; 3 attempts bound the loop.
const writeExclusive = (dir: string, content: string): string => {
  let lastError: unknown = new Error("unreachable")
  for (let attempt = 0; attempt < 3; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(12))
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
    const path = `${dir}/spill-${Date.now().toString(36)}-${hex}.txt`
    try {
      const fd = openSync(path, "wx", 0o600)
      try {
        writeSync(fd, content)
      } finally {
        closeSync(fd)
      }
      return path
    } catch (e: unknown) {
      lastError = e
      if ((e as { code?: unknown }).code !== "EEXIST") throw e
    }
  }
  throw lastError
}

// Dir stats for the status verb: records only, never dials. A missing
// dir reads as empty (first run, nothing spilled yet); real I/O failures
// throw for the caller lane to map. Entry count bounded — a hostile spill
// dir must not hang a read-only check.
export const spillStats = (): { files: number; bytes: number } => {
  const dir = spillDir()
  let entries: Array<string>
  try {
    entries = readdirSync(dir)
  } catch (e: unknown) {
    if ((e as { code?: unknown }).code === "ENOENT") return { files: 0, bytes: 0 }
    throw e
  }
  let files = 0
  let bytes = 0
  for (const name of entries.slice(0, 10000)) {
    try {
      const st = statSync(`${dir}/${name}`)
      if (st.isFile()) {
        files++
        bytes += st.size
      }
    } catch {}
  }
  return { files, bytes }
}

// No retention daemon: spill files live under /tmp and die on reboot
// with everything else there.
