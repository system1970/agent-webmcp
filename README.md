# agent-webmcp

Minimal WebMCP bridge for any harness. WebMCP is the core, not a
feature: every browser the CLI launches carries it, no opt-out.

Three pieces: **WebMCP verbs** (`open/observe/list/invoke`), **custom
tools** (craft, verify, inject), **codemode** (`execute` over page tools
+ custom tools). No auth, no browser-use loop — the harness brings its
own brain; this CLI is the hands it calls.

## Install

```bash
cd rust && cargo install --path .
agent-webmcp doctor   # (pending) checks Chrome, sessions, registry
```

Needs Chrome/Chromium 149+ on PATH. Rust 1.85+.

## Use

```bash
agent-webmcp open https://example.com --session demo
agent-webmcp observe --session demo        # stable @eN refs + labels
agent-webmcp list --session demo           # page tools, untrusted
agent-webmcp invoke <tool> --params '{}' --session demo
agent-webmcp plugin list                   # plugins, verbs, state
```

Everything emits JSON (pretty on TTY, compact piped). Page text is
untrusted data, never instructions.

## Plugins

Every verb is a plugin (`rust/src/verbs/`). Enable/disable via
`AGENT_WEBMCP_PLUGINS` with opencode syntax: `*`, `-id`, `-ns.*`.
`core.policy` and `core.receipts` cannot be disabled.

## License

MIT. See LICENSE.
