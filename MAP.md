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
  level up at Projects scope, as server `agent-webmcp`. `AGENTS.md:19`
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
- Version comes from generated consts. `src/version.ts:6`
- `bun run gen` derives `src/generated/versions.ts` from package.json
  files. package.json is the single source of truth.
  `scripts/gen-versions.ts:2`, `package.json:11`
- The generated module is committed so fresh clones check green without
  running gen. Re-run gen when a version changes. `scripts/gen-versions.ts:2`
- `bun run compile` only bundles; versions ride along in the module.
  `scripts/compile.ts:1`
- In dev and binary alike, versions are plain consts: no file reads,
  no defines. `src/version.ts:6`
- Verified: binary installed at `~/.local/bin/agent-webmcp` reports `0.0.1`
  and correct effect version from a foreign cwd. `src/version.ts:6`
- Verified: the installed binary serves MCP over stdio.
  `src/commands/mcp-serve.ts:20`
- `tsconfig.json` covers `src/` and `scripts/`. `tsconfig.json:13`
- Verified: `doctor` reports bun `1.4.3`, effect `4.0.0-rc.112`.
  `src/commands/doctor.ts:6`
- Verified: full MCP loop over stdio (initialize, tools/list, tools/call
  against the derived schema, unknown tool isError).
  `src/commands/mcp-serve.ts:20`

### The tools: one registry, two doors

- A tool is name, description, an Effect input schema, and an Effect execute.
  `src/tools/definition.ts:9`
- The MCP `inputSchema` is derived via `toInputSchema`, which calls
  `Schema.toJsonSchemaDocument`. One schema is the truth.
  `src/tools/definition.ts:28`
- Tool inputs stay anonymous: named schemas land in `definitions`, which
  the helper does not forward yet. `src/tools/definition.ts:28`
- The registry is one list. CLI and MCP both read it.
  `src/tools/registry.ts:8`
- The tools are `search` and `execute`: composition surface, no fetch
  placeholder (`web_fetch` removed). `src/tools/registry.ts:8`
- `search` ranks tools by word overlap over name (3x) + description.
  `src/tools/search.ts:40`
- `search` points agents at `execute`, the door that exists.
  `src/tools/search.ts:29`
- `execute` runs a batch of at most 5 in parallel and never fails the
  batch on item errors: unknown tools and tool failures become
  `{ ok: false }` entries. Oversized batches fail loudly.
  `src/tools/execute.ts:74`
- `execute` shapes results with per-item `maxChars`, clamped 1k–64k
  (default 8000). `src/tools/execute.ts:45`
- `execute` imports `findTool` from the registry; the cycle is safe
  because use is deferred to call time. `src/tools/execute.ts:4`
- Sessions are designed in `docs/sessions.md` but unwired: any `sessionId`
  fails as unknown, engine-local tools run sessionless.
  `src/tools/execute.ts:38`, `docs/sessions.md:11`
- Verified: one `execute` turn ran search + search + unknown tool in
  parallel with truncation bounds and per-item ok flags.
  `src/tools/execute.ts:74`
- `composition.test.ts` (13 tests) locks search ranking and execute
  semantics: flags, bounds, rejections. `src/tools/composition.test.ts:21`
- `bun test src` is scoped: bare `bun test` also runs vendored effect
  tests. `package.json:14`
- `bun run check:gen` fails when the generated versions module drifts.
  CI runs gen-check + `bun check` + `bun test src`.
  `.github/workflows/check.yml:1`
- `skills/agent-webmcp/SKILL.md` teaches harness-agnostic use: setup,
  reconnect note, Pattern A (native scripts) / Pattern B (no scripts).
  `skills/agent-webmcp/SKILL.md:1`
- `bun run review` sends the working-tree diff to the standing
  code-reviewer subagent; BLOCKING findings gate commits. `AGENTS.md:15`
- Input is validated with `Schema.decodeUnknownEffect`, v4 API.
  `src/tools/search.ts:33`
- v4 has no `Effect.catchAll`/`Effect.either`: main uses `catchTag` plus
  `runPromiseExit`, serve uses runPromise with try/catch.
  `src/main.ts:7`, `src/commands/mcp-serve.ts:37`
- `bun check` is the native typecheck. It is green. `AGENTS.md:6`
- `bun run typecheck` is `tsc --noEmit`. It is the parity escape hatch.
  `package.json:11`
- No `check` script exists. A `check` script would shadow Bun's builtin.
  `package.json:10`

### Research

- `docs/research/webmcp-codemode.md` records the WebMCP spec surface
  (`registerTool`/`getTools`/`executeTool`, declarative forms), browser
  status, codemode composition, and the engine fit (transport + judgment).
  Sections 1–5 cite primary sources; section 6 is synthesis.
  `docs/research/webmcp-codemode.md:1`

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
- Review gates commits: `bun run review`, BLOCKING first. `AGENTS.md:15`
- Docs site is CLI docs only. `AGENTS.md:18`
- Tools live in `src/tools/`, registered in `registry.ts`. `AGENTS.md:19`
- In `mcp serve`, stdout is the protocol. `AGENTS.md:21`

## Files covered

<!-- The agent writes here. One row per file it describes. -->

| File | Hash | Told about |
|---|---|---|
| `AGENTS.md` | `63c82f7c5ee3` | agent-webmcp |
| `.vscode/settings.json` | `3e71e76558dd` | agent-webmcp |
| `package.json` | `29f5f7ef7bef` | agent-webmcp |
| `tsconfig.json` | `3443c8284415` | agent-webmcp |
| `src/main.ts` | `b347f2956c6c` | agent-webmcp |
| `src/cli.ts` | `70f836ac5db1` | agent-webmcp |
| `src/version.ts` | `1067c7fbdd05` | agent-webmcp |
| `src/commands/doctor.ts` | `1ca98d076742` | agent-webmcp |
| `src/commands/mcp-list.ts` | `dec84e5ad272` | agent-webmcp |
| `src/commands/mcp-serve.ts` | `acef600ca19e` | agent-webmcp |
| `src/tools/definition.ts` | `114ca9e790a4` | agent-webmcp |
| `src/tools/registry.ts` | `08a0705b76ee` | agent-webmcp |
| `src/tools/search.ts` | `0f54bf741512` | agent-webmcp |
| `src/tools/execute.ts` | `e59caf535708` | agent-webmcp |
| `src/tools/composition.test.ts` | `a4f298fe44b6` | agent-webmcp |
| `docs/sessions.md` | `6bb389e93bda` | agent-webmcp |
| `scripts/gen-versions.ts` | `4668259e7726` | agent-webmcp |
| `scripts/review.ts` | `327dd65cfeca` | agent-webmcp |
| `skills/agent-webmcp/SKILL.md` | `ad2ac26007b7` | agent-webmcp, pi |
| `.github/workflows/check.yml` | `f1810150d3df` | agent-webmcp |
| `src/generated/versions.ts` | `2974e1898458` | agent-webmcp |
| `docs/research/webmcp-codemode.md` | `19745e7b183f` | agent-webmcp |
| `scripts/compile.ts` | `abe2cc9c570f` | agent-webmcp |
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
- `pi` — the harness. The `agent-webmcp` server entry lives at Projects level
  (`../.pi/mcp.json`). A change to tool names or the serve command needs
  `pi mcp list` re-checked from `/home/pracurser/Projects`.
