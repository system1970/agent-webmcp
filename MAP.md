# MAP.md — agent-webmcp

Facts about this repo. Every fact names a file and a line.

This file is the map. The agent reads it at session start. The agent writes it
when the code moves. Only this region's agent writes this file.

## Rules for the map

1. Facts only. No guesses. If the code does not say it, the map does not say it.
2. Every fact ends with a source. `path:line`.
3. File hashes live in `MAP.hashes` (machine data, checked by
   `bun run preflight`); prose here never carries hashes.
4. History may be corrected when the code it describes moves — stale
   history misleads worse than no history. Delete a line only when the
   file it names is gone.
5. Use short sentences. One meaning per word. Say the thing straight.
6. Timeless over versioned: describe what the code IS, not what a unit
   did. Test counts, verb enumerations, and eval scores rot fastest —
   leave them to the dated log below, or out.

## The map

<!-- The agent writes here. -->

### Shape of the code

- Bun + TypeScript + Effect v4 CLI (`agent-webmcp`); `src/main.ts:1`
  is the entry, `src/cli.ts:10` a flat command table, no framework.
- Six verbs, one registry (`open list search register execute
  close`); MCP serves all six, CLI mirrors the four lifecycle verbs
  (open/list/close/register). `src/tools/registry.ts:8`
- Data-from-print split: `src/sessions/verbs.ts` holds the data fns;
  commands parse argv and print, MCP tools pass JSON.
  `src/sessions/verbs.ts:1`
- Failure lanes: `UsageError` (exit 2), `TransientFailure` (exit 3,
  safe to retry), `CliFailure` (exit 1), defects dump.
  `src/failure.ts:1`, `src/main.ts:9`
- `mcp serve` exposes the registry over stdio (stdout is the
  protocol, stderr diagnostics, self-reaps on stdin EOF).
  `src/commands/mcp-serve.ts:20`
- Versions are generated consts (`bun run gen`, committed).
  `src/version.ts:6`
- `skill show` prints the bundled SKILL.md — version-matched by
  construction, cannot drift. `src/commands/skill.ts:1`
- `repos/` holds read-only vendored reference copies
  (`repos/effect/LLMS.md` first when writing Effect code).
  `AGENTS.md:31`
- Neighbor regions' docs misname this stack (Rust/Go claims) — this
  repo's files win over theirs. `AGENTS.md:5`

### The transport: WebMCP over CDP (Unit 1)

- Transport is a minimal CDP client: `Target` (attach), `Page`
  (navigate/lifecycle), `WebMCP` (tools), plus `Runtime.evaluate`
  (probes, snapshots, and the `register` authoring path).
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
  Reasons: `no-browser`, `flags-missing`, `timeout`, `protocol`,
  `navigated`. `src/transport/errors.ts:6`
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
- `transport.test.ts` locks error shape, catalog merge + quarantine
  (incl. future-tolerant annotations), evaluatePage throw/value/garbage
  paths, tryPromise-fails pin, and wait semantics (timeout-tag mapping,
  session filter) on stub connections — no browser needed.
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
- `open` launches detached (survives the CLI; `close --yes` kills)
  or borrows a foreign tab (navigates it — stated in help; never
  closes/kills foreign). Probe failures refuse below-floor; pages
  with surface but no tools open fine and list empty.
  `src/commands/open.ts:14`
- `list <handle> [tool]`: stat-like rows (name, desc bits,
  schema size); full schema on demand; tool-less pages print a fact,
  exit 0. Piped output defaults to JSON. `src/commands/list.ts:1`
- `close <handle|--all> --yes`: closes targets, kills owned browsers +
  profiles, drops records. Dead browsers are not errors.
  `src/commands/close.ts:1`
- Lanes: `CliFailure` exit 1, `TransientFailure` exit 3 (safe to
  retry), usage exit 2, defects dump. `src/failure.ts:1`
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
- `eval:sessions` runs 7 checks across separate CLI processes
  (open/list/tool-less/close/usage-2/foreign-target/foreign-alive),
  green 2026-10-09. Composition moved to MCP evals; the CLI door
  covers lifecycle only. `scripts/eval-sessions.ts:1`

### Research

- `docs/research/webmcp-codemode.md` records the WebMCP spec surface
  (`registerTool`/`getTools`/`executeTool`, declarative forms), browser
  status, codemode composition, and the engine fit (transport + judgment).
  Sections 1–5 cite primary sources; section 6 is synthesis.
  `docs/research/webmcp-codemode.md:1`

### Stale docs vs live code

- Neighbor regions misname this stack (`../AGENTS.md`: Rust CLI,
  `../orkestrate/AGENTS.md`: Go browser CLI). It is Bun + TS + Effect.
  This repo's files win over theirs. `AGENTS.md:5`

### Codemode discovery (Unit 5) + code execution (Unit 6) + cross-page (Unit 7)

Superseded by Unit 13 (six verbs; `describe`/`invoke`/`status` cut) —
history below, read as history:

- `search` hits carry compact signatures (`name(req: type, opt?: …)`),
  derived from the JSON Schemas we already carry — discovery without a
  second round-trip for arg shapes. `src/tools/search.ts:1`
- `describe {tool, handle?}` is the loop's second step: one full record
  (schema + annotations + origin/session) for page and engine tools
  alike. `src/tools/describe.ts:1`
- Overflow spills to `/tmp/opencode/agent-webmcp-spill/` (0700 dir
  only when we create it, 0600 files, no daemon GC — /tmp dies on
  reboot) with the path in a structured `spill` field on the execute
  envelope, never regexed from text (forged markers are a
  prompt-injection vector). `src/spill.ts:1`
- Skill teaches the positioning: harness codemode composes directly
  (primary), our code-only `execute` matches the shape where the
  harness can't run code (fallback); loop is search → list →
  execute, schemas on demand. `skills/agent-webmcp/SKILL.md:1`
- `execute {code}` runs agent JS in an accident-contained worker
  against one session (bare tools.*) or N sessions under caller
  aliases (sesh.ALIAS.tools.*): denied names shadowed from one list —
  incl. bridge internals, runaways killed, calls capped — containment,
  not a boundary: runs with operator privilege, bridge is the
  deliberate channel, escapes (constructor, `import()`, forged
  `done`) locked as tests. Accepted-risk
  record: `docs/run-accepted-risk.md:1`. 25-call global cap, per-op +
  final size ceilings, worker killed on timeout, values
  structured-cloned, returns carry origins[] + perSession counts.
  7 tools then; 8 with status (Unit 8).
  `src/codemode/runner.ts:1`, `src/tools/execute.ts:1`
- `eval:mcp` (then 14/14 on the 8-verb surface; since reworked
  execute-native for six verbs — see current eval).
  `scripts/eval-mcp.ts:1`
- `eval:xpage` 7/7 (initialize, open-both, open-toolcounts, multisearch-tags, code-join,
  compensation, close-both over two local fixture pages),
  green 2026-10-09. First proof of cross-page flows + in-code
  rollback. `scripts/eval-xpage.ts:1`
- `eval:real` 6/6 (open-both real sites + open_ms, settled-catalogs,
  shim-free xpage-join, close-both), green 2026-10-09. Outside evidence:
  joins consume normalized values with zero unwrapping; slow pages read
  toolCount 0 at open and settle via windowed list. `scripts/eval-real.ts:1`
- `tools/list` poisoning fix 2026-10-09: `status` shipped a typeless
  inputSchema (empty struct derives `anyOf`) and opencode rejected the
  whole list. `toInputSchema` collapses to top-level `{type:"object"}`;
  locked import-time (preflight `schema-object`), wire-level (eval-mcp
  `tools-schemas-object`), and memory (G21 + L10).
  `src/tools/definition.ts:59`

### Unit 15 — strip pass (dead code + CLI composition mirrors)

- Deleted write-only `ConnStats`; runner keeps only the platform
  ceiling (tool owns the rest, same messages). `src/transport/client.ts:1`,
  `src/codemode/runner.ts:280`
- CLI drops `search` + `execute` mirrors (composition belongs on MCP;
  lifecycle open/list/close/register stay). Sessions eval covers the
  CLI door with 7 checks. `src/cli.ts:47`

### Unit 14 — agent ergonomics (JSON default, exit taxonomy, write gate)

- Piped output is JSON unless `--plain` (`resolveJson()` in
  `src/failure.ts:50`); `--json` forces it everywhere. Exit codes are
  the retry policy: 0/2/1 plus 3 transient (`TransientFailure` for
  timeout/no-browser with a retry hint). Writes need `--yes`
  (`register`, `close`; missing flag exits 2). `src/main.ts:1`
- MCP door untouched (no flags there; harness permissions own it);
  `doctor`/`mcp list`/`skill` untouched (out of scope).

### Unit 13 — strip to core (author + codemode + chain)

- Surface is six verbs (`open list search register execute close`):
  `invoke` (execute covers it), `describe` (`list <handle> <tool>`
  already serves full records), `status` (our scaffolding) cut;
  uncommitted `inject` replaced by spec-shaped `register`
  (`{name,title?,description,inputSchema,annotations?}` + body
  source; fixed snippet compiles debugger-side, CSP-exempt; native
  registration, session-scoped). `src/tools/register.ts:1`
- Evals execute-native (single calls ride code blocks); Cloudflare
  eval registers (bridge tool + topHits) instead of injecting.
  `scripts/eval-cloudflare.ts:1`

### Unit 12 — inject + Cloudflare authoring (agent wires a real site)

- `inject` 9th verb (tool + CLI + registry): agent JS runs in the page
  via the CDP evaluate channel; throws surface as `errorText`, stalls
  fail, result labeled untrusted. `src/tools/inject.ts:1`,
  `src/commands/inject.ts:1`
- Cloudflare docs gates first-party tools (`search`, `list-directories`)
  on `navigator.modelContext`; our flagged headless carries the real
  `document.modelContext` — a 10-line bridge + event re-dispatch
  registers them natively (CDP invoke, their AI backend). Custom
  `topHits` (search + page fetch) authored the same way. Their chat
  path 403s preflight for everyone incl. their UI — cut, not chased.
  `scripts/eval-cloudflare.ts:1` (10/10 green 2026-10-09)

### Unit 11 — multi-tab codemode (fan-out joins + close discipline)

- Canonical join block: open N, polyfill everywhere, `Promise.all`
  invokes with miss-as-data, join in code, close-all in `finally`
  with empty-verify. Args serialize via `JSON.stringify` (100k script
  cap). Verified live: two-tab join (64 + 5 = 69), generation 2 → 3
  on navigate with registry loss + reinstall, abort-run tabs reaped
  (zero leaked). Recipe on the docs site + SKILL pointer; no engine
  diff. Noted: website codemode page describes unshipped surface
  (QuickJS/batch/`--program`) — rewrite tracked, not done here.
  `website/app/docs/custom-tools/page.tsx:1`

### Unit 10 — internal-tab adapter (polyfill + harness convention)

- Desktop tabs expose no WebMCP surface and no automation channel:
  unreachable from engine or plugin (four independent verifications).
  The bridge is harness-level: idempotent `modelContext` polyfill via
  `evaluate` (register/getTools/executeTool over a local registry),
  tabID as session handle, list/invoke through the polyfill, close
  what opens. Verified live: single-tab list/invoke/miss + two-tab
  join (`gadget`: onHand 7, ship 5), zero tabs remaining. Recipe on
  the docs site + SKILL pointer; no engine diff. Upstream asks
  (renderer flags, debuggable channel) recorded, undrafted.
  `website/app/docs/custom-tools/page.tsx:1`

### Unit 9 — custom-WebMCP authoring (annotation mapping + recipe)

- Spec `Hint` spellings map to engine base names at both catalog
  paths (`normalizeAnnotations()`, base wins on conflict):
  `readOnlyHint → readOnly`, `untrustedContentHint →
  untrustedContent`; `consequentialHint`/debugging dropped, documented.
  Wrong-typed Hints quarantine the item, never siblings. Verified live
  (`getStock` surfaces `readOnly:true`; was `{}`). Pure + unit-tested.
  `src/transport/client.ts:62`
- Recipe lives on the docs site (its law: install, verbs, authoring):
  registerTool pattern, JSON-shaped returns, annotation table, verify
  loop — replaces a page describing a `tools add` CLI that never
  existed. `website/app/docs/custom-tools/page.tsx:1`

### Unit 8 — retro grounding (normalize + status + reality gate)

- Page outputs normalize to one shape in `invokeSessionTool`:
  `structuredContent` when present, else try-parsed first text part,
  else raw text; scalars pass through. Pure `normalizeOutput()`,
  locked in `src/sessions/verbs.test.ts` (L6 consumption lock).
  `src/sessions/verbs.ts:283`
- `status` is the 8th verb (tool + CLI, registry line): `{sessions:
  [{handle, url}], spill: {files, bytes}}` from records + dir stats,
  never a dial. `src/tools/status.ts:1`, `src/commands/status.ts:1`
- `open` returns point-in-time `toolCount` (one surface read, no
  window); snapshot failure fails the open loud, snapshot-empty opens
  fine at 0. `src/sessions/verbs.ts:46`
- `execute` blurb compressed to 761 rendered chars (was ~1540);
  preflight `desc-budget` fails past 1500. `src/tools/execute.ts:44`
- `eval-mcp` + `eval-xpage` print `open_ms` report-only; `eval-real`
  joins real sites per pre-commit for verb/tool units.
  `scripts/eval-mcp.ts:149`, `scripts/eval-real.ts:1`

### Reviewer v2 (memory + tiers + gates)

- `docs/decisions.md` holds settled scope one-liners (decision, reason,
  date, final); re-litigation without new evidence is out of scope.
  `docs/decisions.md:1`
- `docs/review-learnings.md` holds approved reviewer rules with witness
  + date; rows graduate and prune on human approval only.
  `docs/review-learnings.md:1`
- `bun run preflight` gates reviews deterministically: map-sync,
  help-truth, envelope-snapshot, `bun check`, `bun test src`,
  `bun test scripts/review`, desc-budget, user-surface.
  `scripts/preflight.ts:1`
- `bun run review` tiers by diff size: trivial (<=10 non-hot lines) skips
  the model; lite/full get one pass (full flags size). `--verify` opts
  into a verifier pass over BLOCKINGs (off by default); `--plan` +
  `--dry-run` supported; same-sha reruns hit `reviews/.patch-cache.json`.
  Entry orchestrates only (`scripts/review.ts:1`); jobs live in
  `scripts/review/` (git, brief, cache, verdict, runners, record —
  each unit-tested). `scripts/review/git.ts:1`
- `bun run review:eval` scores 26 golden findings (20 verified, 6
  tracked): fixes stay fixed or the run fails.
  `scripts/review-eval.ts:1`, `scripts/review-eval.json:1`

### MCP surface (six verbs; history: 7 → 8 → 6 across Units 3–13)

- 6 tools in one registry (`search execute open list register
  close`): composition + session verbs sharing data fns with
  the CLI. `src/tools/registry.ts:8`
- CLI mirrors lifecycle verbs (open/list/close/register); composition
  (`search`, `execute`) lives on MCP only. `src/cli.ts:1`
- Verbs split data-from-print: `src/sessions/verbs.ts` holds
  openSession/listSessionTools/registerSessionTool/closeSession/
  closeAllSessions + pickPort (`invokeSessionTool` stays
  engine-internal for the execute dispatch); commands parse argv and
  print, MCP tools pass JSON. `src/sessions/verbs.ts:1`
- Failure mapping lives neutral in `src/failure.ts` (CliFailure,
  TransientFailure, UsageError, resolveJson, asCliFailure,
  asCommandFailure): sessions/tools/commands all import from
  there, no layer owes another. `src/failure.ts:1`
- `search {query, handles?, all?}` ranks engine + page tools together;
  page hits tagged with their session, engine hits `session: null`;
  `all` sweeps best-effort (dead sessions land in `skipped`).
  `src/tools/search.ts:1`
- `execute {code, handle?, sessions?, timeoutMs?, maxChars?}`: code
  runs in a worker against one session (bare tools) or N sessions
  under aliases (sesh.ALIAS.tools); returns value + spill + toolCalls
  + perSession + origins[] with untrusted flags. `src/tools/execute.ts:1`
- `register {handle, tool, code}`: spec-shaped authoring through a
  fixed snippet (native registration, session-scoped).
  `src/tools/register.ts:1`
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
  list (6) → open (toolCount + open_ms) → execute single-call
  (normalized, untrusted) → search/list w/ session → execute code
  block → spilling execute → execute control-flow → close.
  12/12 green 2026-10-09.
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

File hashes live in `MAP.hashes` (machine data for `bun run preflight`;
never agent reading). Add rows there, not here.

## Agents to tell

- `agent-webmcp` — this repo
- `orkestrate` — when a change here needs the platform. The setup prompt,
  version string, and browser floor in that repo's copy-blocks describe this
  engine's surface. A change to CLI name, install path, or verbs is a fact
  about that surface.
- `pi` — the harness. The `agent-webmcp` server entry lives at Projects level
  (`../.pi/mcp.json`). A change to tool names or the serve command needs
  `pi mcp list` re-checked from `/home/pracurser/Projects`.
