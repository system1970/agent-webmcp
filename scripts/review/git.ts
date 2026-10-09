// Git plumbing for the review gate. Every spawn fails loud: an empty diff
// from a dead git is a vacuous pass, never a green.
export const textOf = (out: Uint8Array | null): string =>
  new TextDecoder().decode(out ?? new Uint8Array())

export const gitText = (args: Array<string>): string => {
  const proc = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" })
  if ((proc.exitCode ?? 1) !== 0) {
    const tail = textOf(proc.stderr).trim().split("\n").slice(-2).join(" | ").slice(0, 160)
    throw new Error(`git ${args.slice(0, 3).join(" ")} failed: ${tail}`)
  }
  return textOf(proc.stdout)
}

// Same exclusions everywhere: vendored code, lock content, build output,
// and past review records are never review target.
export const SCOPE_EX = [".", ":!bun.lock", ":!repos", ":!dist", ":!reviews"]
export const scopeBase = (staged: boolean): Array<string> =>
  staged ? ["diff", "--cached"] : ["diff", "HEAD"]

// Intent-to-add stages the file list (never content) so `git diff HEAD`
// sees new files. Returns the staged paths; the caller announces the
// index write because a read-only gate just mutated index state.
export const stageIntentToAdd = (staged: boolean): Array<string> => {
  if (staged) return []
  const others = gitText(["ls-files", "--others", "--exclude-standard", "--", ...SCOPE_EX])
    .split("\n").map((l) => l.trim()).filter((l) => l !== "")
  if (others.length > 0) {
    const add = Bun.spawnSync(["git", "add", "-N", "--", ...others])
    if ((add.exitCode ?? 1) !== 0) {
      const tail = textOf(add.stderr).trim().split("\n").slice(-2).join(" | ").slice(0, 160)
      throw new Error(`git add -N failed: ${tail}`)
    }
  }
  return others
}

export interface WorkingDiff {
  readonly diff: string
  readonly status: string
  readonly lockStatus: string
}

export const loadWorkingDiff = (staged: boolean): WorkingDiff => {
  const base = scopeBase(staged)
  return {
    diff: gitText([...base, "--", ...SCOPE_EX]),
    status: gitText(["status", "--short", "--", ...SCOPE_EX]),
    // Lockfile drift stays visible even though the diff hides lock content.
    lockStatus: gitText(["status", "--short", "--", "bun.lock"])
  }
}

// One `git diff --numstat` yields both the size and the file list, so the
// gate dials git once here instead of numstat + name-only separately.
// NOTE: git flags must precede the `--` separator — anything after it is a
// path, and a misplaced `--numstat` silently yields default format.
export const loadNumstat = (staged: boolean): string =>
  gitText([...scopeBase(staged), "--numstat", "--", ...SCOPE_EX])

export interface Numstat {
  readonly diffLines: number
  readonly names: Array<string>
}

// Renames arrive brace-expanded in one column (`src/{old => new}/f.ts`);
// expand to the new path so hot-path and learning matching see the file
// the diff actually lands on. Double slashes from emptied segments (`{a => }`)
// collapse to one.
export const expandRename = (path: string): string => {
  const m = /^(.*)\{([^{}]*?) => ([^{}]*?)\}(.*)$/.exec(path)
  if (m === null) return path
  return `${m[1]}${m[3]}${m[4]}`.replace(/\/{2,}/g, "/")
}

export const parseNumstat = (raw: string): Numstat => {
  let diffLines = 0
  const names: Array<string> = []
  for (const line of raw.split("\n")) {
    const parts = line.split("\t")
    if (parts.length < 3) continue
    diffLines += (Number(parts[0]) || 0) + (Number(parts[1]) || 0)
    names.push(expandRename(parts[2]))
  }
  return { diffLines, names }
}

export const TRIVIAL_LINES = 10
export const FULL_LINES = 400
export const HOT_PATHS = ["src/transport/", "src/codemode/runner.ts", "src/budgets.ts"]

export type Tier = "trivial" | "lite" | "full"

// Hot paths always get eyes: a 5-line ceiling change in budgets.ts is
// small but load-bearing, so hot forces full and trivial never applies.
export const computeTier = (diffLines: number, names: Array<string>): { tier: Tier; hot: boolean } => {
  const hot = names.some((n) => HOT_PATHS.some((h) => n === h || n.startsWith(h)))
  if (hot) return { tier: "full", hot }
  if (diffLines <= TRIVIAL_LINES) return { tier: "trivial", hot }
  if (diffLines > FULL_LINES) return { tier: "full", hot }
  return { tier: "lite", hot }
}

export const shortHead = (): string =>
  gitText(["rev-parse", "--short", "HEAD"]).trim()
