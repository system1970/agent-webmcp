# MAP.md — agent-webmcp

Facts about this repo. Every fact names a file and a line.

This file is the map. The agent reads it at session start. The agent writes it
when the code moves. Only this region's agent writes this file.

## Rules for the map

1. Facts only. No guesses. If the code does not say it, the map does not say it.
2. Every fact ends with a source. `path:line`.
3. Every file described here has a hash. If the hash is not the hash of the
   file now, this map is old. Re-read the file. Write the map again.
4. Add to the map. Do not rewrite history. Delete a line only when the file it
   names is gone.
5. Use short sentences. One meaning per word. Say the thing straight.

## The map

<!-- The agent writes here. -->

### Shape of the repo

- Fresh Bun + TypeScript + Effect v4 CLI scaffold. No browser code yet.
  `AGENTS.md:5`, `package.json:14`
- `src/` holds the CLI. `website/` holds the docs site (own `AGENTS.md`).
  `AGENTS.md:10`, `website/AGENTS.md:1`
- Entry point is `src/main.ts`. Binary name is `agent-webmcp`.
  `src/main.ts:1`, `package.json:7`
- `repos/` holds vendored reference copies via `git subtree --squash`.
  `AGENTS.md:17`
- `repos/effect` pins `Effect-TS/effect` at `effect@4.0.0-rc.112`.
  `AGENTS.md:21`
- `repos/effect/LLMS.md` is the agent-facing Effect guide. Read it first.
  `AGENTS.md:26`
- `.vscode/settings.json` excludes `repos/**` from auto-import (`:2`),
  file view (`:4`), watcher (`:7`), and search (`:10`).
  `.vscode/settings.json:2`

### The CLI: hello world

- `src/main.ts` reads `Bun.argv[2]`, defaults to `"world"`.
  `src/main.ts:3`
- `src/main.ts` logs `hello, ${name}!` via `Console.log`.
  `src/main.ts:5`
- `main` is an `Effect`. It runs once via `Effect.runPromise`.
  `src/main.ts:5`, `src/main.ts:7`
- Failure prints the cause and exits `1`. `src/main.ts:8`
- Verified: `bun ./src/main.ts` prints `hello, world!`.
  `src/main.ts:5`
- Verified: `bun ./src/main.ts agent` prints `hello, agent!`.
  `src/main.ts:3`
- `bun check` is the native typecheck. It is green. `AGENTS.md:6`
- `bun run typecheck` is `tsc --noEmit`. It is the parity escape hatch.
  `package.json:11`
- No `check` script exists. A `check` script would shadow Bun's builtin.
  `package.json:10`

### Stale docs vs live code (read these before trusting a guide)

- Root `../AGENTS.md` calls this region a Rust CLI. It is Bun TS.
  `AGENTS.md:5`
- `../orkestrate/AGENTS.md` calls this region a Go browser CLI. It is Bun TS.
  `AGENTS.md:5`
- Live user instruction wins over both: Bun + TS + Effect v4 from scratch.
  `AGENTS.md:5`

### Rules that bind this region

- Bun only. No `npm`/`node` runs. `AGENTS.md:7`
- Side effects go through `Effect`. Run once at the bottom. `AGENTS.md:8`
- `bun check` stays green. `AGENTS.md:10`
- Docs site is CLI docs only. `AGENTS.md:10`

## Files covered

<!-- The agent writes here. One row per file it describes. -->

| File | Hash | Told about |
|---|---|---|
| `AGENTS.md` | `de9cbcb32c25` | agent-webmcp |
| `.vscode/settings.json` | `3e71e76558dd` | agent-webmcp |
| `package.json` | `10cb05acc448` | agent-webmcp |
| `tsconfig.json` | `32c5aa7dc507` | agent-webmcp |
| `src/main.ts` | `89edc2e49573` | agent-webmcp |
| `LICENSE` | `6c253b662168` | agent-webmcp |
| `website/AGENTS.md` | `b0db7c39c182` | agent-webmcp |

Hash is the first 12 characters of `sha256sum`. Told about lists the agents to
tell when this file changes. Use `agent-webmcp` for this repo.

## Agents to tell

- `agent-webmcp` — this repo
- `orkestrate` — when a change here needs the platform. The setup prompt,
  version string, and browser floor in that repo's copy-blocks describe this
  engine's surface. A change to CLI name, install path, or verbs is a fact
  about that surface.
