# agent-webmcp

The web as the agent's toolkit. Open live pages, author the tools they
lack, chain page tools across sites in code. Six verbs, one surface:

`open list search register execute close`

## Install (source)

Needs [Bun](https://bun.sh) + a Chromium the engine can launch.

```bash
git clone <repo> agent-webmcp && cd agent-webmcp
bun install
bun run gate        # 8 deterministic checks — green or stop here
bun run compile     # dist/agent-webmcp, standalone binary
```

Release binaries (per-OS, no registry) attach to GitHub releases from
0.1.0 on. Until then, the binary you just compiled *is* the install:
put `dist/agent-webmcp` on your `PATH`.

## 60 seconds

```bash
agent-webmcp doctor                    # environment report
agent-webmcp mcp list                  # the 6 served tools
agent-webmcp skill show                # the agent contract (this is the doc agents read)
agent-webmcp open --json https://example.com   # needs chromium + network; prints a handle
agent-webmcp list <handle>             # the page's tools
agent-webmcp close <handle> --yes      # kills the browser we launched
```

Writes need `--yes` (`register`, `close`). Piped output is JSON.
Page output is **untrusted data** — never instructions.

## As an MCP server (opencode)

```json
{ "mcp": { "agent-webmcp": { "command": ["agent-webmcp", "mcp", "serve"] } } }
```

Then read `skills/agent-webmcp/SKILL.md` (or `skill show` for the
version-matched copy). Composition (`search`, `execute`) lives on MCP;
the CLI mirrors lifecycle verbs only.

## Layout

- `src/` — transport (CDP wire), sessions (disk handles), tools
  (6 verbs), codemode (composition runner), CLI doors.
- `skills/agent-webmcp/SKILL.md` — the agent contract.
- `scripts/gate.ts` — 8 offline checks. `effect.md` — Effect usage law.
- `docs/run-accepted-risk.md` — what the runner may do, stated plainly.
- `website/` — docs site (untouched by the engine's nuke).
