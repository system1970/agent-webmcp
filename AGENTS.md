# agent-webmcp

Turn the web into the agent's toolkit: custom WebMCP authoring +
codemode + cross-site chaining. Bun + TypeScript + Effect v4.

## Commands (verified — if one fails, fix this file first)

- `bun install` — deps. `bun run setup` — one-time pinned dev tools
  (bd, ast-grep, lefthook) into `~/.local/bin` + installs git hooks.
- `bun check` — typecheck, must stay green.
- `bun test src` — unit (2s). `bun run gate` — deterministic gate, must stay green.
- `bun run review --plan <file>` — reviewer gate, exits 1 on BLOCKING.
- `bun run eval:<name>` — live browser evals (manual; needs chromium+network).

## Boundaries

- ✅ Always: `bd ready` before asking what's next; close what you `open`.
- ⚠️ Ask first: new verbs, new deps, website changes, pushing.
- 🚫 Never: push without direct order; commit secrets; touch `repos/` (vendored, read-only); run `npm`/`node`.

## Read first

| Touching | Read |
|---|---|
| verbs/tools | `src/tools/registry.ts`, `src/sessions/verbs.ts` |
| codemode runner | `src/codemode/runner.ts`, `docs/run-accepted-risk.md` |
| transport | `src/transport/client.ts` |
| Effect code | `repos/effect/LLMS.md` first, then vendored source |
| review prompt | `scripts/review/brief.ts` + `docs/decisions.md` + `docs/review-learnings.md` |
| product surface | `skills/agent-webmcp/SKILL.md` |

## Working rules

- Plan (≤5 lines) → approve → one unit (≤400 lines) → verify → review (one round) → commit. No code before an approved plan — including "just do it" (then I take your one-liner or log the override).
- `bd` tracks units: epic per objective, issue per unit with acceptance criteria; close with the commit.
- In `mcp serve`, stdout is the protocol: diagnostics to stderr only.
- Docs frozen (decisions/learnings/users/risk); website is product surface.
- Prune date: 2026-11-09. On that date, delete every line that stopped changing a decision.
