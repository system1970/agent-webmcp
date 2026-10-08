# MAP.md — agent-webmcp

Facts about this repo. Every fact names a file and a line.

This file is the map. The agent reads it at session start. The agent writes it
when the code moves. Only this region's agent writes this file.

## Rules for the map

1. Facts only. No guesses. If the code does not say it, the map does not say it.
2. Every fact ends with a source. `path:line`.
3. Every file described here has a hash. If the hash is not the hash of the
   file now, this map is old. Re-read the file. Write the map again.
4. Add to the map. Do not rewrite history. Delete a line only when the file it
   names is gone.
5. Use short sentences. One meaning per word. Say the thing straight.

## The map

<!-- The agent writes here. -->

### Shape of the repo

- Fresh Bun + TypeScript + Effect v4 CLI scaffold. No browser code yet.
  `AGENTS.md:5`, `package.json:14`
- `src/` holds the CLI. `website/` holds the docs site (own `AGENTS.md`).
  `AGENTS.md:10`, `website/AGENTS.md:1`
- Entry point is `src/main.ts`. Binary name is `agent-webmcp`.
  `src/main.ts:1`, `package.json:7`
- `repos/` holds vendored reference copies via `git subtree --squash`.
  `AGENTS.md:17`
- `repos/effect` pins `Effect-TS/effect` at `effect@4.0.0-rc.112`.
  `AGENTS.md:21`
- `repos/effect/LLMS.md` is the agent-facing Effect guide. Read it first.
  `AGENTS.md:26`
- `.vscode/settings.json` excludes `repos/**` from auto-import (`:2`),
  file view (`:4`), watcher (`:7`), and search (`:10`).
  `.vscode/settings.json:2`

### The CLI: skeleton (pi-shaped)

- Commands are a flat table in `src/cli.ts`. No framework.
  `src/cli.ts:10`
- Commands are `doctor` and `mcp`. `src/cli.ts:22`
- `doctor` reports bun, platform, effect, tools. `--json` for scripts.
  `src/commands/doctor.ts:6`
- `.pi/mcp.json` does not exist in this repo. Pi registration lives one
  level up at Projects scope, as server `agent-webmcp`. `AGENTS.md:19`
- The Projects-level entry spawns `mcp serve` via absolute repo path.
  `src/commands/mcp-serve.ts:20`
- Projects scope still needs one human trust approval inside pi.
  `AGENTS.md:19`
- `mcp list` prints the registry. `--json` for scripts.
  `src/commands/mcp-list.ts:6`
- `mcp serve` exposes the registry over stdio. `src/commands/mcp-serve.ts:20`
- Stdout is the protocol in serve mode. Diagnostics go to stderr.
  `src/commands/mcp-serve.ts:15`
- `UsageError` exits `2`. Everything else exits `1`. `src/main.ts:7`
- Version comes from generated consts. `src/version.ts:6`
- `bun run gen` derives `src/generated/versions.ts` from package.json
  files. package.json is the single source of truth.
  `scripts/gen-versions.ts:2`, `package.json:11`
- The generated module is committed so fresh clones check green without
  running gen. Re-run gen when a version changes. `scripts/gen-versions.ts:2`
- `bun run compile` only bundles; versions ride along in the module.
  `scripts/compile.ts:1`
- In dev and binary alike, versions are plain consts: no file reads,
  no defines. `src/version.ts:6`
- Verified: binary installed at `~/.local/bin/agent-webmcp` reports `0.0.1`
  and correct effect version from a foreign cwd. `src/version.ts:6`
- Verified: the installed binary serves MCP over stdio.
  `src/commands/mcp-serve.ts:20`
- `tsconfig.json` covers `src/` and `scripts/`. `tsconfig.json:13`
- Verified: `doctor` reports bun `1.4.3`, effect `4.0.0-rc.112`.
  `src/commands/doctor.ts:6`
- Verified: full MCP loop over stdio (initialize, tools/list, tools/call
  against the derived schema, unknown tool isError).
  `src/commands/mcp-serve.ts:20`

### The tools: one registry, two doors

- A tool is name, description, an Effect input schema, and an Effect execute.
  `src/tools/definition.ts:9`
- The MCP `inputSchema` is derived via `toInputSchema`, which calls
  `Schema.toJsonSchemaDocument`. One schema is the truth.
  `src/tools/definition.ts:28`
- Tool inputs stay anonymous: named schemas land in `definitions`, which
  the helper does not forward yet. `src/tools/definition.ts:28`
- The registry is one list. CLI and MCP both read it.
  `src/tools/registry.ts:8`
- The tools are `search` and `execute`: composition surface, no fetch
  placeholder (`web_fetch` removed). `src/tools/registry.ts:8`
- `search` ranks tools by word overlap over name (3x) + description.
  `src/tools/search.ts:31`
- `search` clamps `limit` to 1–50 (default 8) via pure `clampLimit`;
  non-finite falls back to default. `src/tools/search.ts:20`
- `search` points agents at `execute`, the door that exists.
  `src/tools/search.ts:40`
- `execute` runs a batch of at most 5 in parallel and never fails the
  batch on item errors: unknown tools and tool failures become
  `{ ok: false }` entries. Oversized batches fail loudly.
  `src/tools/execute.ts:74`
- `execute` shapes results with per-item `maxChars`, clamped 1k–64k
  (default 8000). `src/tools/execute.ts:45`
- `execute` imports `findTool` from the registry; the cycle is safe
  because use is deferred to call time. `src/tools/execute.ts:4`
- Sessions are designed in `docs/sessions.md` but unwired: any `sessionId`
  fails as unknown, engine-local tools run sessionless.
  `src/tools/execute.ts:38`, `docs/sessions.md:11`
- Verified: one `execute` turn ran search + search + unknown tool in
  parallel with truncation bounds and per-item ok flags.
  `src/tools/execute.ts:74`
- `composition.test.ts` (18 tests) locks search ranking, limit clamping,
  and execute semantics: flags, bounds, rejections.
  `src/tools/composition.test.ts:21`
- `bun test src` is scoped: bare `bun test` also runs vendored effect
  tests. `package.json:14`
- `bun run check:gen` fails when the generated versions module drifts.
  CI runs gen-check + `bun check` + `bun test src`.
  `.github/workflows/check.yml:1`
- `skills/agent-webmcp/SKILL.md` teaches harness-agnostic use: setup,
  reconnect note, Pattern A (native scripts) / Pattern B (no scripts).
  `skills/agent-webmcp/SKILL.md:1`
- `bun run review` sends the working-tree diff to the standing
  code-reviewer subagent; BLOCKING findings gate commits. Intent-to-add
  stages new files so the diff sees them (announced on stderr); both diff
  and status exclude `bun.lock` + `repos/`.
  Both runners proven against the same model (pi verified end-to-end
  2026-10-08; opencode earlier). Works wherever OPENCODE_API_KEY resolves.
  `AGENTS.md:15`, `scripts/review.ts:29`
- Input is validated with `Schema.decodeUnknownEffect`, v4 API.
  `src/tools/search.ts:33`
- v4 has no `Effect.catchAll`/`Effect.either`: main uses `catchTag` plus
  `runPromiseExit`, serve uses runPromise with try/catch. Inside the
  runtime side effects go through `Console`; past `runPromiseExit` the
  edge uses raw process I/O by design. `src/main.ts:4`,
  `src/commands/mcp-serve.ts:37`
- `bun check` is the native typecheck. It is green. `AGENTS.md:6`
- `bun run typecheck` is `tsc --noEmit`. It is the parity escape hatch.
  `package.json:11`
- No `check` script exists. A `check` script would shadow Bun's builtin.
  `package.json:10`

### The transport: WebMCP over CDP (Unit 1)

- Transport is a minimal CDP client: `Target` (attach), `Page`
  (navigate/lifecycle), `WebMCP` (tools), plus `Runtime.evaluate` for the
  page-support probe only — never for driving pages.
  `src/transport/client.ts:1`
- The live protocol (probed from Chromium 152 `/json/protocol`, not docs):
  `WebMCP.enable/disable`, `invokeTool {frameId, toolName, input}` returning
  `{invocationId}`, `cancelInvocation`, events `toolsAdded/toolsRemoved/
  toolInvoked/toolResponded`. Discovery is event-driven: no list command,
  enable replays current tools. `src/transport/client.ts:1`
- This build's annotations are `readOnly/untrustedContent/autosubmit` — no
  `consequentialHint` in 152. `toolResponded.output` is documented untrusted
  at the protocol level. `src/transport/client.ts:7`
- Chromium 152 ships WebMCP natively (registers tools with no flags);
  older builds are below the floor. `src/transport/errors.ts:17`
- WebMCP is the core, not an opt-in — but Chromium still gates the page
  surface behind a Testing flag on some origins. Verified live (152):
  https pages expose modelContext unflagged; http (incl. localhost)
  answers undefined without the flag, object with it. Every launched
  browser carries WEBMCP_LAUNCH_FLAGS: no-op where it ships, required
  where it doesn't (same default agent-browser ships).
  `src/transport/errors.ts:17`
- Browsers below the floor (no WebMCP even with the flag, pre-152) fail
  with webmcpFloorFix: 152+. `src/transport/errors.ts:17`
- `TransportFailed` names operation + reason + numeric CDP code + fix.
  Reasons: `no-browser`, `flags-missing`, `timeout`, `protocol`.
  `src/transport/errors.ts:6`
- `invokeTool` awaits the terminal `toolResponded` for its invocationId;
  Completed-with-Error returns as page data, only stalls fail — and stalls
  cancel first. Default timeout 30s, never indefinite.
  `src/transport/client.ts:461`
- All CDP replies are Schema-decoded (`TargetCreated`, `SessionAttached`,
  `InvokeReply`, `ToolResponded`): a malformed reply fails `protocol`, never
  dies on a cast. `probePageSupport` maps malformed evaluate replies to
  `protocol`, never silent false. `src/transport/client.ts:1`
- Events carry their flattened `sessionId`; waits and snapshots filter to
  their own session — multi-page safe. `src/transport/client.ts:301`
- Catalog merge is pure `mergeToolEvent`, keyed name+frameId (cross-frame
  collisions are two tools). Entries decode per-item; malformed ones are
  quarantined, never keyed `undefined::undefined`. `collectTools` snapshots
  honestly inside a window; sessions hold the subscription open.
  `src/transport/client.ts:374`
- Launched browsers get per-port `--user-data-dir` (no shared-profile
  contention, removed on close) and SIGKILL close (no port-stealing
  strays). Launch failures carry browser stderr.
  `src/transport/launch.ts:1`
- v4 gotchas, learned the hard way: `Schema.Literals([...])` for unions
  (multi-arg `Literal` collapses to its first value); options-form
  `Effect.tryPromise` without `catch` dies instead of failing — always pass
  `catch` or use function form; `Effect.callback` replaces `Effect.async`
  (interrupt cleanup unregisters listeners); no `Effect.catchAll`, use
  `Effect.catch`. `src/transport/client.ts:1`
- `transport.test.ts` (13 tests) locks error shape, catalog merge +
  quarantine (incl. future-tolerant annotations), tryPromise-fails
  pin, and wait semantics (timeout-tag mapping, session filter) on a
  stub connection — no browser needed.
  `src/transport/transport.test.ts:1`
- `scripts/eval-transport.ts` runs 3 live evals, zero tokens (bad endpoint,
  two-pages, live list+invoke+Completed); manual, not CI (no browser there).
  `scripts/eval-transport.ts:49`
- Evals: bad-endpoint (no-browser), two-pages (session isolation live:
  distinct frames per page), live list+invoke+Completed with catalog
  reshape. Sequential windows are lossy — sessions must subscribe from
  attach, proven by eval2's first failure mode.
- Verified 2026-10-08: 3/3 evals green against live Chromium 152 +
  flightsearch demo, zero stray browsers (SIGKILL close).
  `scripts/eval-transport.ts:49`

### Sessions + verbs (Unit 2)
- Sessions persist as re-attachable handles on disk
  (`/tmp/opencode/agent-webmcp-sessions/<handle>.json`), not live
  sockets: every verb dials, reattaches the recorded target, works,
  closes. Tmp dies on reboot, as do browsers — records never outlive
  the machine. `src/sessions/store.ts:1`
- `open [--cdp URL [--target SUB]] [--port N] [--json] <url>` launches
  detached (survives the CLI; `close` kills) or borrows a foreign tab
  (navigates it — stated in help; never closes/kills foreign). Refuses
  below-floor pages where the probe fails. `src/commands/open.ts:14`
- `list <handle> [tool] [--json]`: stat-like rows (name, desc bits,
  schema size); full schema on demand; tool-less pages print a fact,
  exit 0. `src/commands/list.ts:1`
- `invoke <handle> <tool> '<json>'`: Completed-with-Error is data;
  output always delimited + origin-labeled + untrusted; ambiguous
  same-name frames fail with candidates. `src/commands/invoke.ts:9`
- `close <handle|--all>`: closes targets, kills owned browsers +
  profiles, drops records. Dead browsers are not errors.
  `src/commands/close.ts:1`
- `CliFailure` is the middle lane: clean stderr + exit 1. Usage stays
  exit 2, defects stay dumps. `src/failure.ts:1`
- Proven live: `WebMCP.enable` does NOT backfill on fresh sessions —
  reattached catalogs seed from `snapshotTools` (page surface) merged
  with the live window (`sessionTools`, events win).
  `src/transport/client.ts:424`
- `reattach` maps attach-phase failure to `navigated` (verified live:
  dead targets answer -32602; anything else rethrows).
  `src/transport/client.ts:317`
- Handles are jailed (`^s_[a-z0-9]+$`): traversal refused, removal
  failures loud. Verb budgets live in one block (`budgets.ts`).
  Annotations print only what the page claims (no capability defaults).
- Known limit: snapshot tools attribute the main frame (the surface
  names none). Iframe tools mis-invoke as TransportFailed, honestly but
  wrongly; held-subscription sessions (daemon) will carry true frameIds.
  Event entries without frameIds quarantine instead — opposite evidence,
  opposite default, both counted.
- `eval:sessions` runs 9 checks across separate CLI processes
  (open/list/invoke/unknown-tool/tool-less/close/usage-2/foreign-target/
  foreign-alive), all green 2026-10-08. `scripts/eval-sessions.ts:1`

### Research

- `docs/research/webmcp-codemode.md` records the WebMCP spec surface
  (`registerTool`/`getTools`/`executeTool`, declarative forms), browser
  status, codemode composition, and the engine fit (transport + judgment).
  Sections 1–5 cite primary sources; section 6 is synthesis.
  `docs/research/webmcp-codemode.md:1`

### Stale docs vs live code (read these before trusting a guide)

- Root `../AGENTS.md` calls this region a Rust CLI. It is Bun TS.
  `AGENTS.md:5`
- `../orkestrate/AGENTS.md` calls this region a Go browser CLI. It is Bun TS.
  `AGENTS.md:5`
- Live user instruction wins over both: Bun + TS + Effect v4 from scratch.
  `AGENTS.md:5`

### MCP surface (Unit 3)

- 6 tools in one registry: `search execute` (composition) + `open list
  invoke close` (session verbs, same data fns as the CLI). `mcp serve`
  needed no changes — snapshot-at-connect stands, proxy tools cover
  dynamic pages. `src/tools/registry.ts:8`
- Verbs split data-from-print: `src/sessions/verbs.ts` holds
  openSession/listSessionTools/invokeSessionTool/closeSession/
  closeAllSessions + pickPort; commands parse argv and print, MCP tools
  pass JSON. `src/sessions/verbs.ts:1`
- Failure mapping lives neutral in `src/failure.ts` (CliFailure,
  UsageError, asCliFailure): sessions/tools/commands all import from
  there, no layer owes another. `src/failure.ts:1`
- `search {query, sessionHandle?}` ranks engine + page tools together;
  page hits tagged with their session, engine hits `session: null.
  `src/tools/search.ts:1`
- `execute {calls, sessionId?, maxChars?}`: sessionId is a session
  handle — one shared connection per batch, page results as JSON
  envelopes with origin + untrusted flags. `src/tools/execute.ts:1`
- Posture lands with the surface: every page envelope carries
  `{untrusted: true, origin}`; SKILL.md teaches never-promote,
  never-run-suggested-shell, hints-enforce-nothing.
  `skills/agent-webmcp/SKILL.md:1`
- `skill show` prints the bundled SKILL.md via text import (ambient
  `*.md` declaration for the typecheckers) — version-matched by
  construction, cannot drift. `src/commands/skill.ts:1`
- Budgets moved to neutral `src/budgets.ts` (sessions + commands share,
  no layering debt). `src/budgets.ts:1`
- `eval:mcp` drives `mcp serve` over stdio with no model: initialize →
  list (6) → open → invoke (Completed + untrusted) → search w/ session
  → execute w/ session → close. 8/8 green 2026-10-09.
  `scripts/eval-mcp.ts:1`

### Rules that bind this region

- Bun only. No `npm`/`node` runs. `AGENTS.md:11`
- Side effects go through `Effect` (`Console` in-runtime, raw process I/O
  at the settled edge). `AGENTS.md:12`
- `bun check` stays green. `AGENTS.md:13`
- Review gates commits: `bun run review`, BLOCKING first. `AGENTS.md:15`
- Docs site is CLI docs only. `AGENTS.md:18`
- Tools live in `src/tools/`, registered in `registry.ts`. `AGENTS.md:19`
- In `mcp serve`, stdout is the protocol. `AGENTS.md:21`

## Files covered

<!-- The agent writes here. One row per file it describes. -->

| File | Hash | Told about |
|---|---|---|
| `AGENTS.md` | `0e4adb726623` | agent-webmcp |
| `.vscode/settings.json` | `3e71e76558dd` | agent-webmcp |
| `package.json` | `2686da734fe4` | agent-webmcp |
| `tsconfig.json` | `3443c8284415` | agent-webmcp |
| `src/main.ts` | `732525a39f85` | agent-webmcp |
| `src/cli.ts` | `a70418e3e9bd` | agent-webmcp |
| `src/version.ts` | `1067c7fbdd05` | agent-webmcp |
| `src/commands/doctor.ts` | `1ca98d076742` | agent-webmcp |
| `src/commands/mcp-list.ts` | `dec84e5ad272` | agent-webmcp |
| `src/commands/mcp-serve.ts` | `acef600ca19e` | agent-webmcp |
| `src/tools/definition.ts` | `5945966d469e` | agent-webmcp |
| `src/tools/registry.ts` | `c37568472e66` | agent-webmcp |
| `src/tools/search.ts` | `8c528f75309c` | agent-webmcp |
| `src/tools/execute.ts` | `d9090ddee609` | agent-webmcp |
| `src/tools/composition.test.ts` | `a7389595209e` | agent-webmcp |
| `docs/sessions.md` | `7b52ca56e77f` | agent-webmcp |
| `scripts/gen-versions.ts` | `4668259e7726` | agent-webmcp |
| `scripts/review.ts` | `2b2e7d08e459` | agent-webmcp |
| `skills/agent-webmcp/SKILL.md` | `f89023c43b4e` | agent-webmcp, pi |
| `.github/workflows/check.yml` | `f1810150d3df` | agent-webmcp |
| `src/generated/versions.ts` | `2974e1898458` | agent-webmcp |
| `docs/research/webmcp-codemode.md` | `19745e7b183f` | agent-webmcp |
| `scripts/compile.ts` | `abe2cc9c570f` | agent-webmcp |
| `src/transport/errors.ts` | `564b7b8e0799` | agent-webmcp |
| `src/transport/client.ts` | `16e5820f0bf9` | agent-webmcp |
| `src/transport/launch.ts` | `c0aaf9104547` | agent-webmcp |
| `src/transport/transport.test.ts` | `33223e399ba8` | agent-webmcp |
| `scripts/eval-transport.ts` | `3282f5671797` | agent-webmcp |
| `src/failure.ts` | `4ca144d8ce8e` | agent-webmcp |
| `src/commands/open.ts` | `2ceff40ddd06` | agent-webmcp |
| `src/commands/list.ts` | `284a296f02ac` | agent-webmcp |
| `src/commands/invoke.ts` | `e33fc777be60` | agent-webmcp |
| `src/commands/close.ts` | `12eef95cdd70` | agent-webmcp |
| `src/sessions/store.ts` | `ad83d18374cb` | agent-webmcp |
| `src/sessions/connect.ts` | `07af85055e7e` | agent-webmcp |
| `src/sessions/store.test.ts` | `ec2d9c5274da` | agent-webmcp |
| `src/transport/devtools.ts` | `d387cffadc5d` | agent-webmcp |
| `scripts/eval-sessions.ts` | `0122cd5b177a` | agent-webmcp |
| `src/commands/budgets.ts` | `06886f355e2a` | agent-webmcp |
| `src/tools/open.ts` | `57bed3c05763` | agent-webmcp |
| `src/tools/list.ts` | `7f872fc75755` | agent-webmcp |
| `src/tools/invoke.ts` | `84dea50520c4` | agent-webmcp |
| `src/tools/close.ts` | `0c21eaafef74` | agent-webmcp |
| `src/sessions/verbs.ts` | `b0b004b90e34` | agent-webmcp |
| `src/commands/skill.ts` | `4c6074d3b4ca` | agent-webmcp |
| `src/budgets.ts` | `d203fe03ba72` | agent-webmcp |
| `src/md.d.ts` | `592511bb79fe` | agent-webmcp |
| `scripts/eval-mcp.ts` | `f45179ae6de0` | agent-webmcp |
| `LICENSE` | `6c253b662168` | agent-webmcp |
| `website/AGENTS.md` | `b0db7c39c182` | agent-webmcp |

Hash is the first 12 characters of `sha256sum`. Told about lists the agents to
tell when this file changes. Use `agent-webmcp` for this repo.

## Agents to tell

- `agent-webmcp` — this repo
- `orkestrate` — when a change here needs the platform. The setup prompt,
  version string, and browser floor in that repo's copy-blocks describe this
  engine's surface. A change to CLI name, install path, or verbs is a fact
  about that surface.
- `pi` — the harness. The `agent-webmcp` server entry lives at Projects level
  (`../.pi/mcp.json`). A change to tool names or the serve command needs
  `pi mcp list` re-checked from `/home/pracurser/Projects`.
