# webmcp-cli — flags, sessions, eval, MCP bridge

Companion to the `agent-webmcp` skill core. Load when configuring sessions, passing flags, or wiring the MCP bridge.

## Commands (purpose-first; exact syntax lives in `--help`)

| Command | Reach for it when |
|---|---|
| `open [url] [--session NAME] [--desc "purpose"] [--headed] [--chrome PATH] [--json]` | Starting work: attaches to the session's Chrome (launches if dead), navigates only when the URL differs. No URL = attach + report. `--desc` labels the purpose. |
| `list [--session NAME] [--json]` | You need names, schemas, frameIds. The only source of invocable tools. |
| `invoke <tool> [--params JSON\|@file] [--frame ID] [--timeout-ms N] [--json]` | Acting. Params is always a JSON object; default timeout 30s. |
| `scan [--query t] [--role button] [--limit N] [--hidden] [--json]` | Perceiving UI: compact interactable map (`@eN` refs are re-groundable descriptions, not handles). Empty `list` starts here. |
| `act <click\|type\|select\|hover\|focus\|key\|clear> <@ref\|css:...> [--text ..] [--match N] [--submit] [--json]` | Acting on UI: one atomic action, framework-correct input, reports `navigated`. Never `act` a ref you haven't `scan`ned. |
| `read [--scope body\|main\|css:..] [--limit N] [--json]` | Observing state: page text + char counts. Verify effects here, not in the return. |
| `wait --for nav\|stable\|text=..\|selector=.. [--min-growth N] [--baseline N] [--json]` | Mechanical settle: stop changing + (optional) growth past baseline. Settle is signal AND substance. |
| `trace <on\|dump\|off> [--api] [--query t] [--limit N] [--json]` | Network capture: record CDP traffic during a turn; `dump --api` surfaces XHR/fetch calls a compiled tool should prefer over DOM replay. |
| `skills test <skill> [--session NAME] [--json]` | Verifying: run a skill's `evals.json` checks live against the open page. No green, no ship. |
| `eval <js> [--session NAME] [--json]` | Inspecting page state the tools don't expose (`Runtime.evaluate`). Debugging hatch — actuation still belongs to page tools. |
| `cookies import (--from-port PORT \| --from-session NAME) [--session NAME] [--domain a.com,b.com] [--json]` | Starting logged in: copy cookies from your real browser (launched with `--remote-debugging-port=PORT`) or another session into this one. |
| `status / sessions / close [--all]` | Lifecycle. `sessions` is the picker: name, live/dead, desc, url, idle. `sessions note --session NAME --desc ".."` relabels without launching. `close` keeps profile + label for fast resume. |
| `mcp [--session NAME]` | Exposing the 6-tool bridge to an MCP harness. |
| `skills [get <topic>]` | This reference system, served by the binary. |

## Flags and environment

`--session/-s` (default `default`, or `AGENT_WEBMCP_SESSION`) · `--json` (envelope `{ok, data|error, code}`) · `--timeout-ms` (default 30000). Chrome resolution: `--chrome` → `AGENT_WEBMCP_CHROME` → system Chrome → Brave/Chromium. Extra chrome flags: `AGENT_WEBMCP_CHROME_FLAGS` (whitespace-separated, e.g. `--no-sandbox` for rootless containers). Headless (`headless=new`) by default; `--headed` opens a real visible window owned by the session (watching needs no other tool) — switching modes needs a session restart (`close`, then `open --headed`) and a display. Chrome launch failures report the tail of the session's `chrome.log`.

## Sessions (reuse first, never spam)

One session is one isolated Chrome under `~/.agent-webmcp/sessions/<name>/` (`cdp-port`, `chrome.pid`, `profile/`, `meta.json`). The browser outlives each CLI call, so steps share tabs, logins, and page state.

1. `sessions` first — pick a live session whose desc + url fit. Attach with `open --session NAME` (no URL).
2. Create only on miss — `open <url> --session <name> --desc "site + purpose"`.
3. Relabel anytime — `sessions note --session <name> --desc ".."`.
4. Concurrent agents take different names. `close` frees Chrome but keeps profile + label.

## Starting logged in

Fresh sessions start logged out (isolated profiles). To skip manual login, import cookies before opening the target site:

```bash
agent-webmcp cookies import --from-session personal --session work --domain github.com
# or from your everyday browser (relaunch it once with --remote-debugging-port=9222):
agent-webmcp cookies import --from-port 9222 --session work --domain github.com
```

Only cookies move — sites keeping auth in localStorage/IndexedDB still need one manual login (`open --headed`; the profile then persists). `--domain` filters by apex + subdomains; without it, everything imports.

## Custom tools

When native tools don't cover the job, store your own. A pack is a JS file (async IIFE) that registers tools via the page's own `document.modelContext`:

```bash
agent-webmcp tools add ./my-pack.js --for example.com   # store (+ live-loads if the tab matches)
agent-webmcp tools list                                  # stored packs + host rules
agent-webmcp tools load --session demo                   # manual load into the current tab
agent-webmcp tools remove my-pack
```

Packs auto-load on `open` when the host matches (exact host or `*`), appear in `list` next to native tools, and invoke through the normal path. Label overlay registrations `[agent overlay]` in the description so agents can tell injected tools from the site's own. Provenance is also structural: `list --json` sets `"overlay": true` on CLI-registered tools (tracked per session), and text output tags them `[overlay: ...]`. Registrations live until navigation — `open` re-injects. Catalog skills ship their packs (`skills-catalog/<skill>/overlay.js`).

## MCP client config

```json
{ "mcpServers": { "agent-webmcp": {
  "command": "agent-webmcp",
  "args": ["mcp", "--session", "default"]
} } }
```

Six tools only (`open`, `list_webmcp_tools`, `execute_webmcp_tool`, `close`, `search_capabilities`, `describe_capability`) so the bridge slots beside existing browser tools without bloating context. Prefer task-scoped sessions (`--session <task>`) over `default`.
