# MAP.md — agent-webmcp (Rust)

Facts about this repo. Every fact names a file and a line.

## The map

### Shape of the repo

- One Cargo package, binary `agent-webmcp`. `rust/src/*.rs`, `rust/src/verbs/*.rs`. rust/Cargo.toml:1
- Deps: clap (derive), reqwest (blocking), tungstenite, serde_json, anyhow. rust/Cargo.toml:7
- Sync only: no async runtime anywhere. rust/src/cdp.rs:1
- Docs site: `website/` (Next.js, rewrite pending for Rust verbs).
- Parked: `zig/` (CDP spike, stdlib churn shelved it).

### Plugin system

- Everything is a plugin: id, permissions, verbs, hooks. rust/src/plugin.rs:20
- Permissions: Browser, Network, Secrets, Fs, Spawn — requested, host-enforced (enforcement pending). rust/src/plugin.rs:16
- Control syntax from env AGENT_WEBMCP_PLUGINS: `*`, `-id`, `-ns.*`, later ID re-enables. rust/src/main.rs:12
- `core.policy` and `core.receipts` ignore removals. rust/src/plugin.rs:60
- Verbs receive (&Ctx, &Registry, args); `plugin list` describes via the registry. rust/src/plugin.rs:30, rust/src/verbs/core.rs:51
- Hooks wrap every call: before may veto, after observes. rust/src/main.rs:60
- Unknown verbs fail hard with a `bad_verb` envelope, exit 2. rust/src/main.rs:75
- Pretty for TTY, compact when piped. rust/src/main.rs:68

### Browser verbs (browser.*)

- `open <url>`: free port, launch headless Chromium (always with WebMCP flags), navigate, wait loadEventFired, save session. rust/src/verbs/browser.rs:53
- `observe`: snapshot JS over Runtime.evaluate: stable @eN refs, kinds click/fill/select/scroll, password/file/hidden skipped. rust/src/verbs/browser.rs:7
- Sessions: name -> port+url files under ~/.agent-webmcp/rust/, liveness-checked on load. rust/src/session.rs:10

### WebMCP (core, not a feature)

- Launch always carries WebMCP flags; no opt-out exists. rust/src/cdp.rs:26
- Discovery: enable, listTools fast path, event drain fallback (quiet 250ms, cap 900ms). rust/src/webmcp.rs:230
- Invocation: invokeTool, callTool fallback, async toolResponded wait (30s). rust/src/webmcp.rs:262
- Method-absent errors match the method-absent family (wasn't found, no such, unsupported...). rust/src/webmcp.rs:8
- `list`/`invoke` verbs live in webmcp.tools; every envelope carries untrusted:true. rust/src/verbs/webmcp.rs:40

## Files covered

| File | Hash | Told about |
|---|---|---|
| rust/src/main.rs | d2399afdf969 | agent-webmcp |
| rust/src/plugin.rs | 6ef738812ebd | agent-webmcp |
| rust/src/cdp.rs | 8f14040eefa7 | agent-webmcp |
| rust/src/session.rs | 36f13d5c6aa9 | agent-webmcp |
| rust/src/webmcp.rs | d9ecde9b61e3 | agent-webmcp |
| rust/src/verbs/mod.rs | b88dcfdab73c | agent-webmcp |
| rust/src/verbs/core.rs | 8e7a3f599b4c | agent-webmcp |
| rust/src/verbs/browser.rs | a8e01aaa95af | agent-webmcp |
| rust/src/verbs/webmcp.rs | a1c6a6fc0fc7 | agent-webmcp |
| rust/Cargo.toml | 885562e7b8e0 | agent-webmcp |

## Agents to tell

- `agent-webmcp` — this repo
