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
- Docs site lives in `website/` (own `AGENTS.md`) — CLI docs only.
