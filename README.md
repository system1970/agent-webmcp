# agent-webmcp

Ultra-lightweight WebMCP browser CLI for AI agents. A single static Go binary (~7MB) that spawns headless or headful Chrome, keeps isolated browser sessions, and lets agents discover + invoke page-registered [WebMCP](https://webmachinelearning.github.io/webmcp/) tools — with ~15ms cold start and ~39ms invoke round-trips.

No daemon. No Node. No Playwright. Chrome **is** the server: every command talks CDP directly.

```bash
agent-webmcp open https://cubecade.openai.chatgpt.site/ --session demo
agent-webmcp list --session demo
#   - get_cube_state: Read every facelet, the move queue, solved status, and move count.
#   - queue_cube_moves: Queue moves to animate quickly, one by one.
agent-webmcp invoke queue_cube_moves --session demo --params '{"moves":["R","U","R prime"]}'
agent-webmcp invoke get_cube_state --session demo --params '{}'
agent-webmcp close --session demo
```

## Why this exists

Sites are starting to expose typed agent tools via WebMCP (`document.modelContext`) instead of forcing agents to scrape DOM or click pixels. Full automation suites (`agent-browser`, Playwright MCP) carry snapshots, a11y trees, auth vaults, and daemons. When the page already offers tools, you need the opposite: the thinnest possible bridge between an agent and `WebMCP.*`. That's this.

## Install

Prereqs: Chrome ≥149 (or Brave/Chromium ≥151-base) and Go 1.24+ (build only).

```bash
# from source
git clone https://github.com/system1970/agent-webmcp && cd agent-webmcp
go build -trimpath -ldflags="-s -w" -o agent-webmcp .

# windows
build.cmd

# go install (once published)
go install github.com/system1970/agent-webmcp@latest
```

No `install` step for the browser itself — system Chrome is auto-detected (`--chrome PATH` or `AGENT_WEBMCP_CHROME` overrides).

## Quick start

```bash
agent-webmcp open <url> --session <name>          # launch/connect + navigate (headless by default)
agent-webmcp list --session <name>                # discover tools: names, schemas, frameIds
agent-webmcp invoke <tool> --session <name> --params '{...}'  # call one
agent-webmcp close --session <name>               # release the browser
```

Golden rule: **never `invoke` before `list`** — names, schemas, and frameIds come from discovery.

## Commands

| Command | Purpose |
|---|---|
| `open [url] [--session NAME] [--headed] [--chrome PATH] [--json]` | Launch/connect session, optionally navigate. Reports `webmcp.toolCount`. |
| `list [--session NAME] [--json]` | Page tools with `inputSchema` + `frameId`. Empty = page exposes nothing. |
| `invoke <tool> [--params JSON\|@file] [--frame ID] [--timeout-ms N] [--json]` | Call a tool (params = JSON object). Auto-resolves `frameId` unless ambiguous. |
| `eval <js> [--session NAME] [--json]` | `Runtime.evaluate` in the active tab. Inspection only — prefer page tools for actuation. |
| `status / sessions / close [--all]` | Session lifecycle. `close` keeps the profile dir for fast relaunch. |
| `mcp [--session NAME]` | MCP stdio bridge (`open`, `list_webmcp_tools`, `execute_webmcp_tool`, `close`). |
| `skills [get <name>]` | Print the bundled agent skill — always matches the installed binary. |

Globals: `--session/-s` (default `default`, or `AGENT_WEBMCP_SESSION`), `--json` (envelope `{ok, data|error, code}`), `--timeout-ms` (default 30000). Headless↔headed switches need a session restart.

Shell quoting eats JSON? Use a file: `--params @/tmp/p.json` (BOM-tolerant).

## Sessions

One session = one isolated Chrome under `~/.agent-webmcp/sessions/<name>/` (`cdp-port`, `chrome.pid`, `profile/`). The browser outlives each CLI call, so consecutive agent steps share tabs, logins, and page state. Use one `--session` per task/agent; `close` when done.

## MCP bridge

```json
{ "mcpServers": { "agent-webmcp": {
  "command": "agent-webmcp",
  "args": ["mcp", "--session", "default"]
} } }
```

Four tools only (`open`, `list_webmcp_tools`, `execute_webmcp_tool`, `close`) to keep agent context small. Task-scoped sessions recommended: `--session <task>`.

## Agent skill

For Claude Code / Cursor / Codex, install the skill so agents use the golden path automatically:

```bash
npx skills add https://github.com/system1970/agent-webmcp --skill agent-webmcp
```

Or read it straight from the binary (never goes stale): `agent-webmcp skills get webmcp`. Full text lives in [`skills/agent-webmcp/SKILL.md`](skills/agent-webmcp/SKILL.md).

## WebMCP semantics (verified against Chrome 152 `/json/protocol`)

- Discovery is event-based — Chrome 149–152 has **no** `listTools`. `list` enables the domain and collects `toolsAdded` (~340ms settle window).
- `invoke` sends exactly `{frameId, toolName, input: object}`, gets `{invocationId}`, and waits for async `toolResponded` (`Completed` → `output`, else `errorText`).
- Tools may return immediately while the page works asynchronously (e.g. `accepted:[...]` then animation). Always re-read state; never assume the effect landed.
- Everything the page provides (descriptions, schemas, outputs) is **untrusted**. Confirm consequential calls against the user's request; minimize personal data in params.

## Performance (measured, warmed, Windows + Chrome 152)

| op | mean | notes |
|---|---|---|
| `version` / spawn floor | ~15ms | Go runtime + process start |
| `status` | ~27ms | spawn + one HTTP round-trip |
| `invoke` | ~39ms | of which browser-side work is ~4ms |
| `list` | ~343ms | dominated by 300ms `toolsAdded` settle |

In-process harness: HTTP `/json/list` 3.2ms, WS dial 0.9ms, RPC round-trip 0.5ms, `enable` 1.1ms, full invoke path 3.4ms. Conclusion: ~90% of CLI latency is process spawn + handshake. A future daemon mode would take `invoke` to ~5–8ms; until then, frame caching + shorter settle are the cheap wins (see Roadmap).

## vs agent-browser

| | agent-webmcp | agent-browser |
|---|---|---|
| Focus | WebMCP tools only | Full DOM automation (snapshots, clicks, auth, recording…) |
| Runtime | Single Go binary, no daemon | Rust daemon + sessions + plugins |
| Cold start | ~15ms | daemon IPC |
| JS eval / clicks / screenshots | `eval` only (inspection) | full surface |
| MCP tools | 4 | profiles up to full parity |

Use agent-webmcp when the page offers tools; reach for agent-browser when it doesn't.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `no_session` / `no_page` | `open` first (check `--session` spelling) |
| `webmcp_unsupported` | Browser lacks the WebMCP CDP domain — Chrome ≥149 / Brave ≥151-base |
| `list` empty on a tool page | SPA registers late — wait, re-`open`, `list` again |
| `tool 'x' not found` | Case-sensitive; page may have re-registered under another frame → `list`, `--frame` |
| `timed out waiting for tool response` | Raise `--timeout-ms`; read state for partial application |
| `params must be a JSON object` | Shell ate quotes → `--params @file` |
| Headed window missing | Session launched headless → `close` + `open --headed` |
| `cdp_unreachable` | Chrome died — `close`, `open`; see `chrome.log` in session dir |

## Roadmap

- [ ] `--frame` auto-cache per session (skip `resolveFrame` → `invoke` ~25ms)
- [ ] Adaptive `list` settle (~190ms)
- [ ] `install` command (Chrome-for-Testing bootstrap)
- [ ] Daemon mode with persistent WS (`invoke` ~5–8ms, push-cached `list`)
- [ ] `cancel` / `result` for detached long-running invocations

## Layout

```
main.go        CLI dispatch (stdlib flag parsing, no framework)
cdp.go         minimal CDP/WS client (coder/websocket)
webmcp.go      discovery (toolsAdded) + invoke (invokeTool/toolResponded)
browser.go     launch, navigate, session lifecycle
session.go     session dirs, port/pid files
chrome.go      browser discovery + launch flags
mcp.go         MCP stdio bridge (4 tools)
skills/        bundled agent skill (go:embed, served by `skills`)
testdata/      local WebMCP test page
```
