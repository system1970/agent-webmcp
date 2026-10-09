// setup: one-time pinned dev-tool install (bd, ast-grep, lefthook).
// Usage: `bun run setup`. Linux x86_64 only — other platforms exit 2
// (their pins go here, not in chat). Downloads over TLS into /tmp/opencode,
// verifies sha256 against publisher checksums where published, installs to
// ~/.local/bin, then `lefthook install` wires pre-commit for this repo.
// Re-runs skip tools whose pinned version already resolves on PATH.
// Exits 0 done, 1 failure, 2 unsupported platform. No secrets, no prompts.
import { createHash } from "node:crypto"
import { chmodSync } from "node:fs"

const arch = `${process.platform}-${process.arch}`
if (arch !== "linux-x64") {
  console.error(`setup: unsupported platform '${arch}' (add its pins in scripts/setup.ts)`)
  process.exit(2)
}
const home = process.env.HOME
if (home === undefined || home === "") {
  console.error("setup: HOME unset")
  process.exit(1)
}

const tmp = "/tmp/opencode"
const bin = `${home}/.local/bin`
const root = `${import.meta.dir}/..`

const fetchTo = async (url: string, dest: string): Promise<void> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`)
  await Bun.write(dest, res)
}

const sha256 = async (path: string): Promise<string> =>
  createHash("sha256").update(await Bun.file(path).bytes()).digest("hex")

// Publisher checksums.txt: find the asset line, compare full hash.
const verifySums = async (sumsUrl: string, file: string, path: string): Promise<void> => {
  const dest = `${tmp}/CHECKSUMS.${file}`
  await fetchTo(sumsUrl, dest)
  const line = (await Bun.file(dest).text()).split("\n").find((l) => l.trim().endsWith(`  ${file}`))
  const want = line?.split(/\s+/)[0]
  if (want === undefined) throw new Error(`no checksum line for ${file}`)
  const actual = await sha256(path)
  if (actual !== want) throw new Error(`sha256 mismatch for ${file}: got ${actual}`)
}

// ast-grep ships no publisher checksums: hash pinned on first maintainer
// TLS download 2026-10-09. Bump version + hash together, never one alone.
const AST_GREP_SHA = "0fd3f489639abb8465a914b74b8779171577582318d8a940d00399f59dba81c5"

const onPath = (name: string, want: string, args: Array<string> = ["--version"]): boolean => {
  if (Bun.which(name) === null) return false
  const proc = Bun.spawnSync([name, ...args], { stdout: "pipe", stderr: "pipe" })
  return new TextDecoder().decode(proc.stdout ?? new Uint8Array()).includes(want)
}

const step = async (label: string, done: () => Promise<void>): Promise<void> => {
  try {
    await done()
  } catch (err) {
    console.error(`setup: ${label} FAILED: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

await step("bd 1.3.0", async () => {
  if (onPath("bd", "1.3.0")) {
    console.log("setup: bd 1.3.0 present")
    return
  }
  // Publisher is the gastownhall org (v1.3.0 artifacts + checksums.txt
  // verified there 2026-10-09; beads.gascity.com docs track it).
  // .beads/README.md still names steveyegge/beads upstream — if the
  // canonical org moves again, bump URLs + hashes together.
  const file = "beads_1.3.0_linux_amd64.tar.gz"
  await fetchTo(`https://github.com/gastownhall/beads/releases/download/v1.3.0/${file}`, `${tmp}/${file}`)
  await verifySums("https://github.com/gastownhall/beads/releases/download/v1.3.0/checksums.txt", file, `${tmp}/${file}`)
  const proc = Bun.spawnSync(["tar", "xzf", file, "bd"], { cwd: tmp, stdout: "pipe", stderr: "pipe" })
  if (proc.exitCode !== 0) throw new Error("tar extract failed")
  await Bun.write(`${bin}/bd`, Bun.file(`${tmp}/bd`))
  chmodSync(`${bin}/bd`, 0o755)
  console.log("setup: bd 1.3.0 installed")
})

await step("ast-grep 0.50.0", async () => {
  if (onPath("ast-grep", "0.50.0")) {
    console.log("setup: ast-grep 0.50.0 present")
    return
  }
  const file = "app-x86_64-unknown-linux-gnu.zip"
  await fetchTo(`https://github.com/ast-grep/ast-grep/releases/download/0.50.0/${file}`, `${tmp}/${file}`)
  const actual = await sha256(`${tmp}/${file}`)
  if (actual !== AST_GREP_SHA) throw new Error(`sha256 mismatch: got ${actual}`)
  const proc = Bun.spawnSync(["unzip", "-o", "-j", file, "ast-grep", "-d", tmp], { cwd: tmp, stdout: "pipe", stderr: "pipe" })
  if (proc.exitCode !== 0) throw new Error("unzip failed")
  await Bun.write(`${bin}/ast-grep`, Bun.file(`${tmp}/ast-grep`))
  chmodSync(`${bin}/ast-grep`, 0o755)
  console.log("setup: ast-grep 0.50.0 installed")
})

await step("lefthook 2.2.1", async () => {
  if (onPath("lefthook", "2.2.1", ["version"])) {
    console.log("setup: lefthook 2.2.1 present")
    return
  }
  const file = "lefthook_2.2.1_Linux_x86_64"
  await fetchTo(`https://github.com/evilmartians/lefthook/releases/download/v2.2.1/${file}`, `${tmp}/${file}`)
  await verifySums("https://github.com/evilmartians/lefthook/releases/download/v2.2.1/lefthook_checksums.txt", file, `${tmp}/${file}`)
  await Bun.write(`${bin}/lefthook`, Bun.file(`${tmp}/${file}`))
  chmodSync(`${bin}/lefthook`, 0o755)
  console.log("setup: lefthook 2.2.1 installed")
})

// Wire pre-commit for this repo (PATH-prefixed so the fresh binaries win).
const hook = Bun.spawnSync(["lefthook", "install"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
})
if ((hook.exitCode ?? 1) !== 0) {
  const err = new TextDecoder().decode(hook.stderr ?? new Uint8Array()).trim().split("\n").slice(-3).join(" | ")
  console.error(`setup: lefthook install FAILED: ${err.slice(0, 200)}`)
  process.exit(1)
}
console.log("setup: done (lefthook pre-commit installed)")
