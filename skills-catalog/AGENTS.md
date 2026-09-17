# skills-catalog — per-site skill contract

One dir per site skill. Local catalog is the primary door (`search` → `describe` → `skills test`).

## Required files

- `SKILL.md` — full manual + verbs. Frontmatter: `name`, `description`, `allowed-tools`.
- `overlay.js` — async IIFE registering via page's own `document.modelContext`. Fixed verbs only, grounding queries (role+name, visible-first). No new selectors beyond what `scan`/`act` proved. Label registrations `[agent overlay]`.
- `evals.json` — `{page, checks:[{verb, params, expect:{contains}, timeoutMs}]}`. Mechanical, live-page. `skills test <skill>` must be green before ship.

## Rules

- Native tools end whole jobs — no overlay for what's already a tool.
- Stub when degraded: `verbs: []`, no `overlay.js`/`evals.json` (see `eve/`). Report `gated, not absent` on login/bot walls.
- Reload for real: `tools remove` → `tools add --for <host>` → REAL navigation (different URL, then target) → `list` shows new descriptions → `skills test`.
- `Duplicate tool name` = stale live tab (site owns it), expected on re-inject.
