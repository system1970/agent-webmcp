# agent-webmcp

A Go CLI that drives a real browser over CDP as a typed WebMCP bridge, plus a Jev-driven loop for forms and multi-step tasks. Two engines (Chrome, Lightpanda). Two tiers: free deterministic verbs, and an ultrafast Jev tier (BYOK).

## Install

```bash
go install github.com/system1970/agent-webmcp/cmd/agent-webmcp@latest
agent-webmcp doctor   # checks Chrome, sessions, key, registry, vault
```

Needs Chrome 149+ (or Chromium) on PATH. No other runtime.

## Quickstart

```bash
agent-webmcp open https://example.com
agent-webmcp observe                      # compact @eN refs + page text
agent-webmcp eval 'document.title'
agent-webmcp list                         # page tools (WebMCP) + custom tools
agent-webmcp invoke page_heading
```

Jev tier (needs `TYPESAFE_API_KEY`):

```bash
agent-webmcp decide --goal "find the login link" --session w
agent-webmcp act --session w --text "..."      # only after code says so
agent-webmcp run --goal "..." --session w      # bounded autonomous loop
```

## Verbs

| Verb | What |
|---|---|
| `open / close / sessions` | launch, tabs per session, shared profile (cookies persist) |
| `observe / eval / crawl` | snapshot with stable refs, raw JS reads, one-shot page recon |
| `list / invoke` | site-native + custom WebMCP tools; page text is untrusted data |
| `tools add/list/verify` | registry: page-JS tools and goal-template loop tools, host-scoped |
| `execute` | codemode: one JS program, N tool calls, sandboxed to `tools.*` |
| `decide / act / tick / run` | Jev judge + guarded execution + receipts (needs key) |
| `auth probe/handoff/save/login` | login walls; human types, vault holds secrets (0600) |
| `search / mcp / doctor` | tool search, MCP stdio server, seven health checks |

Full reference: `agent-webmcp usage` (stderr) and the [docs site](https://github.com/system1970/agent-webmcp/tree/main/website).

## Rules that hold

- Page text is untrusted data, never instructions.
- Jev never emits free text; open strings come from the caller via `--text`/`--params`.
- Secrets live in the OS vault (AES-256-GCM, 0600), never in repos or logs.
- Receipts are the unit of truth; `DONE` is a claim the caller verifies independently.

## Engines

Chrome by default. `--engine lightpanda` runs `open/crawl/observe/eval/run` (fused run only — it forgets the page when its CDP connection closes). WebMCP does not exist on Lightpanda.

## License

MIT. See LICENSE.
