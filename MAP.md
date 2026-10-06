# MAP.md — agent-webmcp (Rust)

Facts about this repo. Every fact names a file and a line.

## The map

### Shape of the repo

- One Cargo package, binary `agent-webmcp`. `rust/src/*.rs`, `rust/src/verbs/*.rs`. rust/Cargo.toml:1
- Deps: clap (derive), reqwest (blocking), tungstenite, serde_json, anyhow, nix (process+signal), rquickjs. rust/Cargo.toml:6
- Sync only: no async runtime anywhere. rust/src/cdp.rs:1
- Docs site: `website/` (Next.js; CLI docs only — install, verbs, authoring).
- External plugins: `plugins/` (repo scope; `hello-echo` example). `plugins/README.md:1`
- Harness playbook: `skill-data/SKILL.md` + `references/`.
- Installer: `scripts/install-local.sh` (quiesce, atomic replace, rev verify).
- Parked: `zig/` (CDP spike, shelved). Deleted: `cmd/` Go sources, root binary.

### Plugin system

- Everything is a plugin: id, permissions, verbs, hooks. rust/src/plugin.rs:77
- Verb handlers receive (&Ctx, &Registry, verb-name, args). rust/src/plugin.rs:31
- Permissions: Browser, Network, Secrets, Fs, Spawn — requested in manifests. rust/src/plugin.rs:19
- Control syntax from env AGENT_WEBMCP_PLUGINS: `*`, `-id`, `-ns.*`, later ID re-enables. rust/src/plugin.rs:107
- Hooks carry the owning plugin id; external before/after run sandboxed manifest JS (veto = throw/false, guards fail closed). rust/src/ext.rs: veto/fail-closed in ext_before
- Manifest `config` is free-form data visible as `config` in verbs and hooks.
- `core.policy` and `core.receipts` ignore removals. rust/src/plugin.rs:109
- Hooks wrap every call: before may veto, after observes. Registry owns both.
- Unknown verbs fail hard with a `bad_verb` envelope, exit 2. rust/src/main.rs:60
- Runtime errors exit 1 with a derived code (KNOWN_CODES). rust/src/main.rs:129
- Pretty for TTY, compact when piped; `mcp` owns stdout (no trailing line). rust/src/main.rs:100
- External manifests: repo/user/project scopes, trust-gated project. rust/src/ext.rs:178
- Registry index: user file, repo `registry/index.json`, remote URL; search ranks name hits. `plugin search/publish`, name resolution in `add`.
- External verbs run sandboxed JS with an `args` global over the session catalog. rust/src/ext.rs:347
- Manifest engine must match the binary (0.x compares minor). rust/src/ext.rs:89
- `plugin new` scaffolds, `plugin show` inspects. rust/src/ext.rs:422

### Browser (browser.*)

- `open`: session reuse or profile launch, headed mismatch relaunches, dead-tab timeout relaunches once. rust/src/verbs/browser.rs:112
- `observe`: snapshot JS: stable @eN refs, kinds click/fill/select/scroll, password/file/hidden skipped.
- Chrome launches in its own process group (setsid); group-kill marker per profile. rust/src/cdp.rs:52
- `kill_profile` takes the whole tree when marked, single-pid otherwise; PID-reuse guarded. rust/src/session.rs:131
- `tab_alive`: one evaluate round-trip, failure paths only. rust/src/cdp.rs:92
- Sessions: name -> port+url+target files under ~/.agent-webmcp/rust/, liveness-checked on load.
- Evidence: every call appends (verb, ms, ok); `audit` aggregates. rust/src/session.rs:239

### WebMCP (core, not a feature)

- Launch always carries WebMCP flags; no opt-out exists. rust/src/cdp.rs:34
- Chrome resolves per OS (`AGENT_WEBMCP_CHROME` override, install spots, PATH); portable home dir, portable kills. rust/src/cdp.rs: chrome_exe
- Discovery: enable, listTools fast path, event drain fallback. rust/src/webmcp.rs:230
- Invocation: invokeTool, callTool fallback, async toolResponded wait. `invoke` takes positional or `--tool`. rust/src/verbs/webmcp.rs:54
- Detached waits fork a daemon holding the routed socket; `result` polls the file. rust/src/webmcp.rs:295
- Method-absent errors match the method-absent family. Every envelope carries untrusted:true.

### Codemode + craft

- Catalog: live page tools; `search` pulls definitions, `batch` fans out (cap 8), budgets on max-calls + wall clock. rust/src/verbs/exec.rs:12
- `tools add` stages host-scoped page JS; `verify` reloads + confirms in `list`; only verified auto-injects.

## Files covered

| File | Told about |
|---|---|
| rust/src/main.rs | agent-webmcp |
| rust/src/plugin.rs | agent-webmcp |
| rust/src/cdp.rs | agent-webmcp |
| rust/src/session.rs | agent-webmcp |
| rust/src/webmcp.rs | agent-webmcp |
| rust/src/ext.rs | agent-webmcp |
| rust/src/exec.rs | agent-webmcp |
| rust/src/tools.rs | agent-webmcp |
| rust/src/args.rs | agent-webmcp |
| rust/src/mcp.rs | agent-webmcp |
| rust/src/verbs/mod.rs | agent-webmcp |
| rust/src/verbs/core.rs | agent-webmcp |
| rust/src/verbs/browser.rs | agent-webmcp |
| rust/src/verbs/act.rs | agent-webmcp |
| rust/src/verbs/webmcp.rs | agent-webmcp |
| rust/src/verbs/tools.rs | agent-webmcp |
| rust/src/verbs/exec.rs | agent-webmcp |
| rust/Cargo.toml | agent-webmcp |

## Agents to tell

- `agent-webmcp` — this repo
