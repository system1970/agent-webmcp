// Registry: authored tools as files. Root resolves env → walk-up
// project `.agent-webmcp/` → per-OS user-global. READS roam (project
// then global); WRITES require project-or-env (fail loud otherwise —
// never silently leak one project's tools into another's).
// Layout: <root>/<origin-slug>/<name>/{spec.json, body.js}.
// origin.txt guards slug collisions; symlinks escaping root refuse.
import { Data, Effect } from "effect"
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, normalize, relative, sep } from "node:path"

export type RegistryReason =
  | "no-root"
  | "outside-root"
  | "symlink"
  | "origin-mismatch"
  | "missing"
  | "corrupt"
  | "io"

export class RegistryFailed extends Data.TaggedError("RegistryFailed")<{
  readonly reason: RegistryReason
  readonly message: string
  readonly fix: string
}> {}

export const REGISTRY_ENV = "AGENT_WEBMCP_REGISTRY" as const
export const REGISTRY_DIR = ".agent-webmcp/registry" as const

export const userGlobalRoot = (platform: string = process.platform): string => {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? tmpdir()
  if (platform === "darwin") return `${home}/Library/Application Support/agent-webmcp/registry`
  if (platform === "win32") return `${process.env.LOCALAPPDATA ?? home}/agent-webmcp/registry`
  return `${home}/.local/share/agent-webmcp/registry`
}

// Pure resolution: env wins, else nearest ancestor holding
// `.agent-webmcp/`, else undefined (caller decides read-fallback vs
// write-failure). `exists` is injected so unit tests never touch fs.
export const resolveProjectRoot = (
  startDir: string,
  env: string | undefined,
  exists: (dir: string) => boolean
): string | undefined => {
  if (env !== undefined && env !== "") return env
  let dir = startDir
  for (;;) {
    if (exists(`${dir}/.agent-webmcp`)) return `${dir}/${REGISTRY_DIR}`
    const cut = dir.lastIndexOf("/")
    if (cut <= 0) return undefined
    dir = dir.slice(0, cut)
  }
}

export const slugOf = (origin: string): string => {
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    host = origin.toLowerCase()
  }
  return host.replaceAll(/[^a-z0-9]/g, "-")
}

export interface SavedSpec {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly annotations?: Record<string, unknown>
  readonly fixtureInput?: unknown
  readonly strict?: boolean
  readonly consequential?: boolean
  readonly version: 1
  readonly createdAt: number
  readonly lastVerified?: number
}

export interface SavedTool {
  readonly spec: SavedSpec
  readonly body: string
}

const fail = (reason: RegistryReason, message: string, fix: string): RegistryFailed =>
  new RegistryFailed({ reason, message, fix })

// Inside-root check: normalize (kills `..`), then lstat EVERY path
// component from the root down — a symlink at any level (leaf or
// parent) refuses. Leaf-only checks miss parent-symlink escapes.
const checkInside = (root: string, path: string): Effect.Effect<void, RegistryFailed> =>
  Effect.try({
    try: () => {
      const normRoot = normalize(root)
      const normPath = normalize(path)
      const rel = relative(normRoot, normPath)
      if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        throw fail("outside-root", `refusing path outside registry root: ${path}`, "check AGENT_WEBMCP_REGISTRY.")
      }
      let cur = normRoot
      for (const part of rel.split(sep)) {
        cur = `${cur}${sep}${part}`
        try {
          if (lstatSync(cur).isSymbolicLink()) {
            throw fail("symlink", `refusing symlinked registry path: ${cur}`, "use real directories for tool files.")
          }
        } catch (err) {
          if (err instanceof RegistryFailed) throw err
          break // Missing from here down — nothing more to inspect.
        }
      }
    },
    catch: (err) =>
      err instanceof RegistryFailed
        ? err
        : fail("io", `registry guard failed: ${String(err).slice(0, 200)}`, "disk or permissions."),
  })

export const saveTool = (
  root: string,
  origin: string,
  name: string,
  spec: SavedSpec,
  body: string
): Effect.Effect<void, RegistryFailed> =>
  Effect.gen(function* () {
    const dir = `${root}/${slugOf(origin)}/${name}`
    yield* checkInside(root, dir)
    yield* Effect.try({
      try: () => {
        mkdirSync(dir, { recursive: true })
        const marker = `${root}/${slugOf(origin)}/origin.txt`
        try {
          const claimed = readFileSync(marker, "utf8")
          if (claimed !== origin) {
            throw fail(
              "origin-mismatch",
              `registry dir claims a different origin (slug collision): ${dir}`,
              "set AGENT_WEBMCP_REGISTRY to a clean dir."
            )
          }
        } catch (err) {
          if (err instanceof RegistryFailed) throw err
          writeFileSync(marker, origin)
        }
        writeFileSync(`${dir}/spec.json`, JSON.stringify({ ...spec, name }))
        writeFileSync(`${dir}/body.js`, body)
      },
      catch: (err) =>
        err instanceof RegistryFailed
          ? err
          : fail("io", `registry write failed: ${String(err).slice(0, 200)}`, "disk or permissions."),
    })
  })

export const loadTool = (root: string, origin: string, name: string): Effect.Effect<SavedTool, RegistryFailed> =>
  Effect.gen(function* () {
    const dir = `${root}/${slugOf(origin)}/${name}`
    yield* checkInside(root, dir)
    return yield* Effect.try({
      try: () => {
        let raw: string
        let body: string
        try {
          raw = readFileSync(`${dir}/spec.json`, "utf8")
          body = readFileSync(`${dir}/body.js`, "utf8")
        } catch {
          throw fail("missing", `no saved tool '${name}' for ${origin}`, "register it first.")
        }
        let spec: SavedSpec
        try {
          spec = JSON.parse(raw) as SavedSpec
        } catch {
          throw fail("corrupt", `spec.json unparseable for '${name}'`, "re-register the tool.")
        }
        if (spec.name !== name) throw fail("corrupt", `spec name mismatch for '${name}'`, "re-register the tool.")
        return { spec, body }
      },
      catch: (err) =>
        err instanceof RegistryFailed
          ? err
          : fail("io", `registry read failed: ${String(err).slice(0, 200)}`, "disk or permissions."),
    })
  })

export const listOriginTools = (root: string, origin: string): Effect.Effect<ReadonlyArray<string>, RegistryFailed> =>
  Effect.gen(function* () {
    const dir = `${root}/${slugOf(origin)}`
    yield* checkInside(root, dir)
    return yield* Effect.try({
      try: () => {
        try {
          return readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        } catch {
          return [] as ReadonlyArray<string>
        }
      },
      catch: (err) => fail("io", `registry list failed: ${String(err).slice(0, 200)}`, "disk or permissions."),
    })
  })

// Root resolution, read vs write (spec §1): READS roam (project then
// global); WRITES require project-or-env (fail loud — never silently
// leak one project's tools into another's).
export const resolveReadRoot = (
  startDir: string,
  env: string | undefined,
  exists: (dir: string) => boolean,
  platform: string = process.platform
): string | undefined => resolveProjectRoot(startDir, env, exists) ?? userGlobalRoot(platform)

export const resolveWriteRoot = (
  startDir: string,
  env: string | undefined,
  exists: (dir: string) => boolean
): Effect.Effect<string, RegistryFailed> => {
  const found = resolveProjectRoot(startDir, env, exists)
  if (found !== undefined) return Effect.succeed(found)
  return Effect.fail(
    new RegistryFailed({
      reason: "no-root",
      message: "no project registry found (no .agent-webmcp/ upward, no AGENT_WEBMCP_REGISTRY)",
      fix: `set ${REGISTRY_ENV} to persist tools, or create .agent-webmcp/ in the project.`,
    })
  )
}

export const markVerified = (root: string, origin: string, name: string): Effect.Effect<void, RegistryFailed> =>
  Effect.gen(function* () {
    const { spec, body } = yield* loadTool(root, origin, name)
    yield* saveTool(root, origin, name, { ...spec, lastVerified: Date.now() }, body)
  })

export const removeToolDir = (root: string, origin: string, name: string): Effect.Effect<void, RegistryFailed> =>
  Effect.gen(function* () {
    const dir = `${root}/${slugOf(origin)}/${name}`
    yield* checkInside(root, dir)
    rmSync(dir, { recursive: true, force: true })
  })
