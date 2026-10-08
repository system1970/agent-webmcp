# agent-webmcp

Turn the web into the agent's toolkit: an agent as comfortable with
the browser as with a filesystem.

Bun + TypeScript + Effect v4 (`effect@4.0.0-rc`). `bun install`,
`bun ./src/main.ts [name]`, `bun check` (native typecheck, must stay green).

## Rules

- Bun only. No `npm`/`node` runs.
- All side effects go through `Effect`. `main` stays an `Effect`, run once at the bottom with `Effect.runPromise`.
- `bun check` clean before claiming done. `bun run typecheck` (`tsc --noEmit`)
is the parity escape hatch. No `check` script: it would shadow Bun's builtin.
- After implementing and before committing, run `bun run review` (standing
  code-reviewer subagent over the working-tree diff) and address BLOCKING
  findings. `bun test` covers search ranking and execute semantics.
- Docs site lives in `website/` (own `AGENTS.md`) — CLI docs only.
- Tools live in `src/tools/`: one file per tool, registered in `registry.ts`.
  CLI and MCP read the same registry. Add a tool by adding one file + one line.
- In `mcp serve`, stdout is the protocol: diagnostics go to stderr only.
- Pi registration lives at Projects level (`../.pi/mcp.json` as server
  `agent-webmcp`), not in this repo. One registration avoids double loading.

## Vendored repositories

- `repos/` holds read-only reference copies of external projects, vendored
  via `git subtree --squash`. Never edit, never import from them.
- `repos/effect` pins `Effect-TS/effect` at tag `effect@4.0.0-rc.112`
  (matches `package.json`). Update with
  `git subtree pull --prefix=repos/effect <url> <tag> --squash`.
- When writing Effect code, inspect `repos/effect/` for idiomatic usage,
  tests, and module structure. Treat it as the source of truth.
- Always read `repos/effect/LLMS.md` before writing Effect code.
- Prefer patterns from vendored source over guesses or web search.
