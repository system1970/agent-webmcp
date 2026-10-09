# agent-webmcp

Turn the web into the agent's toolkit: custom WebMCP authoring +
codemode + cross-site chaining. Bun + TypeScript + Effect v4 stable.

## Commands (if one fails, fix this file first)

- `bun install` — deps. `bun check` — typecheck, must stay green.
- `bun test src` — unit. `bun run gate` — 8 deterministic checks.
- `bun run compile` — standalone binary.

## Boundaries

- Never: push without direct order; commit secrets; touch `repos/`
  (vendored Effect reference, read-only); run `npm`/`node`.
- Ask first: new verbs, new deps, website changes.

## Read first

| Touching | Read |
|---|---|
| verbs/tools | `src/tools/registry.ts`, `src/sessions/verbs.ts` |
| codemode runner | `src/codemode/runner.ts`, `docs/run-accepted-risk.md` |
| transport | `src/transport/client.ts` |
| Effect usage | `effect.md` (law), then `repos/effect/` source |
| product surface | `skills/agent-webmcp/SKILL.md` |

## Working rules

- No code without an approved plan. One concern per commit.
- In `mcp serve`, stdout is the protocol: diagnostics to stderr only.
- Close what you `open`.
