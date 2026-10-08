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

### The CLI: skeleton (pi-shaped)

- Commands are a flat table in `src/cli.ts`. No framework.
  `src/cli.ts:10`
- Commands are `doctor` and `mcp`. `src/cli.ts:22`
- `doctor` reports bun, platform, effect, tools. `--json` for scripts.
  `src/commands/doctor.ts:6`
- `.pi/mcp.json` does not exist in this repo. Pi registration lives one
  level up at Projects scope, as server `webmcp`. `AGENTS.md:19`
- The Projects-level entry spawns `mcp serve` via absolute repo path.
  `src/commands/mcp-serve.ts:20`
- Projects scope still needs one human trust approval inside pi.
  `AGENTS.md:19`
- `mcp list` prints the registry. `--json` for scripts.
  `src/commands/mcp-list.ts:6`
- `mcp serve` exposes the registry over stdio. `src/commands/mcp-serve.ts:20`
- Stdout is the protocol in serve mode. Diagnostics go to stderr.
  `src/commands/mcp-serve.ts:15`
- `UsageError` exits `2`. Everything else exits `1`. `src/main.ts:7`
- Version comes from `package.json` at runtime. `src/version.ts:5`
- Verified: `doctor` reports bun `1.4.3`, effect `4.0.0-rc.112`.
  `src/commands/doctor.ts:6`
- Verified: full MCP loop over stdio (initialize, tools/list, tools/call
  `web_fetch` on `example.com` returns HTTP 200, unknown tool isError).
  `src/commands/mcp-serve.ts:20`

### The tools: one registry, two doors

- A tool is name, description, JSON inputSchema, and an Effect execute.
  `src/tools/definition.ts:9`
- The registry is one list. CLI and MCP both read it.
  `src/tools/registry.ts:6`
- First tool is `web_fetch`: GET a URL, status plus 8000 chars of body.
  `src/tools/web-fetch.ts:15`
- `web_fetch` is read-only: HTTP errors return data, only network or input
  failures become `ToolFailed`. `src/tools/web-fetch.ts:10`
- Input is validated with `Schema.decodeUnknownEffect`, v4 API.
  `src/tools/web-fetch.ts:28`
- v4 has no `Effect.catchAll`/`Effect.either`: main uses `catchTag` plus
  `runPromiseExit`, serve uses runPromise with try/catch.
  `src/main.ts:7`, `src/commands/mcp-serve.ts:37`
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

- Bun only. No `npm`/`node` runs. `AGENTS.md:11`
- Side effects go through `Effect`. Run once at the bottom. `AGENTS.md:12`
- `bun check` stays green. `AGENTS.md:13`
- Docs site is CLI docs only. `AGENTS.md:15`
- Tools live in `src/tools/`, registered in `registry.ts`. `AGENTS.md:17`
- In `mcp serve`, stdout is the protocol. `AGENTS.md:19`

## Files covered

<!-- The agent writes here. One row per file it describes. -->

| File | Hash | Told about |
|---|---|---|
| `AGENTS.md` | `4ef95e587902` | agent-webmcp |
| `.vscode/settings.json` | `3e71e76558dd` | agent-webmcp |
| `package.json` | `22ee38968eec` | agent-webmcp |
| `tsconfig.json` | `32c5aa7dc507` | agent-webmcp |
| `src/main.ts` | `6fc3aadee5e4` | agent-webmcp |
| `src/cli.ts` | `836aae93cc3c` | agent-webmcp |
| `src/version.ts` | `f897643c954d` | agent-webmcp |
| `src/commands/doctor.ts` | `d7dc538a9ef6` | agent-webmcp |
| `src/commands/mcp-list.ts` | `331da0fad885` | agent-webmcp |
| `src/commands/mcp-serve.ts` | `acef600ca19e` | agent-webmcp |
| `src/tools/definition.ts` | `f02062268d0c` | agent-webmcp |
| `src/tools/registry.ts` | `4181183a145d` | agent-webmcp |
| `src/tools/web-fetch.ts` | `9b70a59031ac` | agent-webmcp |
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
- `pi` — the harness. The `webmcp` server entry lives at Projects level
  (`../.pi/mcp.json`). A change to tool names or the serve command needs
  `pi mcp list` re-checked from `/home/pracurser/Projects`.
