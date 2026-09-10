# webmcp-cli — flags, sessions, eval, MCP bridge

Companion to the `agent-webmcp` skill core. Load when configuring sessions, passing flags, or wiring the MCP bridge.

## Commands (purpose-first; exact syntax lives in `--help`)

| Command | Reach for it when |
|---|---|
| `open [url] [--session NAME] [--headed] [--chrome PATH] [--json]` | Starting work: launches or reuses the session's Chrome, optionally navigates. Reports `webmcp.toolCount` so step 1 and step 2 partially overlap. |
| `list [--session NAME] [--json]` | You need names, schemas, frameIds. The only source of invocable tools. |
| `invoke <tool> [--params JSON\|@file] [--frame ID] [--timeout-ms N] [--json]` | Acting. Params is always a JSON object; default timeout 30s. |
| `eval <js> [--session NAME] [--json]` | Inspecting page state the tools don't expose (`Runtime.evaluate`). Debugging hatch — actuation still belongs to page tools. |
| `status / sessions / close [--all]` | Lifecycle. `close` keeps the profile dir for fast relaunch. |
| `mcp [--session NAME]` | Exposing the 4-tool bridge to an MCP harness. |
| `skills [get <topic>]` | This reference system, served by the binary. |

## Flags and environment

`--session/-s` (default `default`, or `AGENT_WEBMCP_SESSION`) · `--json` (envelope `{ok, data|error, code}`) · `--timeout-ms` (default 30000). Chrome resolution: `--chrome` → `AGENT_WEBMCP_CHROME` → system Chrome → Brave/Chromium. Headless (`headless=new`) by default; switching to `--headed` needs a session restart (`close`, then `open --headed`) and a display.

## Sessions

One session is one isolated Chrome under `~/.agent-webmcp/sessions/<name>/` (`cdp-port`, `chrome.pid`, `profile/`). The browser outlives each CLI call, so steps share tabs, logins, and page state. Concurrent agents take different names; `status` shows port, page count, and active URL for the current one.

## Custom tools

When native tools don't cover the job, store your own. A pack is a JS file (async IIFE) that registers tools via the page's own `document.modelContext`:

```bash
agent-webmcp tools add ./my-pack.js --for example.com   # store (+ live-loads if the tab matches)
agent-webmcp tools list                                  # stored packs + host rules
agent-webmcp tools load --session demo                   # manual load into the current tab
agent-webmcp tools remove my-pack
```

Packs auto-load on `open` when the host matches (exact host or `*`), appear in `list` next to native tools, and invoke through the normal path. Label overlay registrations `[agent overlay]` in the description so agents can tell injected tools from the site's own. Registrations live until navigation — `open` re-injects. Ships with two reference packs in `overlays/`: directory search for webmcp.com, Ask-AI chat for eve.dev.

## MCP client config

```json
{ "mcpServers": { "agent-webmcp": {
  "command": "agent-webmcp",
  "args": ["mcp", "--session", "default"]
} } }
```

Four tools only (`open`, `list_webmcp_tools`, `execute_webmcp_tool`, `close`) so the bridge slots beside existing browser tools without bloating context. Prefer task-scoped sessions (`--session <task>`) over `default`.
