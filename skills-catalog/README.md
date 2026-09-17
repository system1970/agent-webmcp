# skills-catalog

Official agent-webmcp capabilities. Each entry is one directory:

- `skills-catalog/<domain>/<skill>/` — e.g. `github.com/get-pr-review/`
- Contents: `SKILL.md` (frontmatter + instructions) + `overlay.js`
  (toolset) + `evals.json` (test record).

The catalog is intentionally empty right now: entries land here one by one
as they are crafted and live-verified. Empty (apart from this file) is a
valid state — `search` returns nothing, the site shows an empty catalog,
and the build stays green.

This file exists so `go:embed skills-catalog` always matches at least one
file. It is ignored by the index generator and the CLI.
