# Verbs

Thin intents, JSON always. Flags precede or follow positionals;
`--session NAME` (`-s`) selects the tab. Pretty on TTY, compact piped.

## Browse + act

- `open <url> [--session NAME] [--profile NAME] [--headed]`
- `observe [--session NAME]` → `{url, title, count, actions[]}` with
  `{id, kind, role, label}`. kinds: click/fill/select/scroll.
- `click <@eN>` → hit-tested trusted click; refuses occluded/stale.
- `fill <@eN> <text> [--submit]` → focused entry, read-back verified.
- `eval <js>` → page JavaScript, JSON value back.
- `sessions` / `close [--all]` — tabs and profile browsers.

## WebMCP (the page's own tools)

- `list` → page tools, `untrusted: true`.
- `invoke <tool> [--params JSON] [--frame ID]` → one call.
- `result <invocation>` → detached results: pending/ready/error.

## Craft + compose

- `tools add --file <js> --for HOST --name NAME` → stage a page tool.
- `tools verify <name>` → reload, inject, confirm in `list`, stamp.
  Only verified tools auto-inject on `open`.
- `search <terms> [--limit N] [--offset N]` → progressive discovery.
- `execute --program @file|<js> [--max-calls N]` → one program, one
  envelope. See `codemode.md`.

## System

- `plugin list` / `plugin new <id> [--here]` / `plugin show <id>`
- `version`, `audit`, `mcp` (stdio JSON-RPC; same registry as CLI).
- Control: `AGENT_WEBMCP_PLUGINS="*,-ns.*"`. `core.*` immune.
