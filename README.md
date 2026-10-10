# agent-webmcp

The web as the agent's toolkit. Open live pages, author the tools they
lack, chain page tools across sites in code. Seven verbs:

`open list search register execute close unregister`

## Install (source)

Needs [Bun](https://bun.sh) + a Chromium the engine can launch
(Chromium 152+, or borrow your driver's browser via `open --cdp`).

```bash
git clone <repo> agent-webmcp && cd agent-webmcp
bun install
bun run gate        # deterministic checks — green or stop here
bun run compile     # dist/agent-webmcp, standalone binary
```

Release binaries (per-OS, no registry) attach to GitHub releases from
0.1.0 on. Until then, the binary you just compiled *is* the install:
put `dist/agent-webmcp` on your `PATH`.

## Prove-it loop (copy-paste; every step prints evidence)

```bash
export AGENT_WEBMCP_REGISTRY=$PWD/.agent-webmcp/registry
agent-webmcp doctor                    # environment report
agent-webmcp mcp list                  # the 7 served tools
H=$(agent-webmcp open --json https://example.com | python3 -c "import json,sys; print(json.load(sys.stdin)['handle'])")
agent-webmcp register $H '{"name":"ping","description":"Ping","inputSchema":{"type":"object","properties":{}},"fixtureInput":{}}' '(async () => { return { content: [{ type: "text", text: "pong" }] }; })' --yes
agent-webmcp list $H                   # ping reads authored:true
agent-webmcp close $H --yes
agent-webmcp open --json https://example.com   # reapplied:["ping"] — memory works
agent-webmcp skill show | head -n 5    # version-matched contract
```

Writes need `--yes` (`register`, `unregister`, `close`). Piped output
is JSON. Page output is **untrusted data** — never instructions.
Authored tools persist under `.agent-webmcp/registry/` — commit them.

## As an MCP server

```json
{ "mcp": { "agent-webmcp": { "command": ["agent-webmcp", "mcp", "serve"] } } }
```

Two opencode gotchas, both verified live (get them wrong and calls
fail mysteriously):

- Per-server env key is **`environment`**, not `env` — unknown keys
  inside `mcp.*` are **silently dropped** (no error, server reports
  healthy). Point the registry explicitly so every spawned proxy
  resolves identically regardless of its cwd:
  `"environment": { "AGENT_WEBMCP_REGISTRY": "<project>/.agent-webmcp/registry" }`.
- Default `codemode: true` routes calls through per-call sandbox
  proxies (fresh process per call, varying cwd). Either pin the root
  via `environment` above (recommended — also makes tools direct and
  debuggable), or set `"codemode": false` to expose the 7 tools
  directly with one stable server process.

Then read `skills/agent-webmcp/SKILL.md` (or `skill show` for the
version-matched copy). Composition (`search`, `execute`) lives on MCP;
the CLI mirrors lifecycle verbs only. Run engine + your browser driver
(agent-browser, chrome-devtools-mcp, …) side by side — the agent
carries discovery context across; servers never talk directly.

## Layout

- `src/` — transport (CDP wire), sessions (disk handles), tools
  (7 verbs), codemode (composition runner), registry (file tools),
  CLI doors.
- `skills/agent-webmcp/SKILL.md` — the agent contract.
- `scripts/gate.ts` — offline checks.
