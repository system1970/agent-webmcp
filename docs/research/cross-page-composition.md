# Cross-page composition: landscape, trust, unlocks, eval (read 2026-10-09)

Sources: Cloudflare `agents/tools/codemode/{index,how-it-works,browser,mcp}`
docs (2026-06/07); opencode `packages/codemode/README.md` @ dev (fetched
raw); pi `docs/codemode.md` @ 1.1.0 (local install, primary); MCP spec
`draft/server/tools` + `2025-06-18/client/{elicitation,sampling}`;
WebMCP `webmachinelearning/webmcp` README + `webmachinelearning.github.io/webmcp`
spec text; `GoogleChromeLabs/webmcp-tools` demo list;
`vercel-labs/agent-browser` README; Stagehand via `browserbase.com/stagehand`
+ `stagehand.dev`; macaroons via `research.google/pubs` + NDSS'14 paper;
Biscuit via `doc.biscuitsec.org`. Repo facts re-verified in
`src/tools/{registry,search,execute,invoke,describe,list,open}.ts`,
`src/codemode/runner.ts`, `src/sessions/{verbs,store}.ts`, `src/{spill,budgets}.ts`,
`scripts/eval-mcp.ts`, `skills/agent-webmcp/SKILL.md`. Section 3 rankings
and all "inference:" marks are synthesis, not sourced claims.

## 1. Landscape: who composes across pages/connectors, and how

| System | Composition unit | State model | Discovery | Limits |
|---|---|---|---|---|
| Cloudflare `@cloudflare/codemode` + durable runtime | **Multi-connector**: one sandbox calls N connectors (`github.*`, `stripe.*`, MCP-derived) in one program | Durable SQLite facet: executions, call log w/ seq nos, approvals, snippets; executor itself stateless | `codemode.search()` ranked paths, `describe()` typed docs, `run()` saved snippets | 1M-char durable values (no truncation — replay must see identical data); sequential calls when pause possible (else replay divergence); approval-gated methods |
| opencode `@opencode/codemode` | **One host tool-tree** (multi-namespace, single trust domain: host chose every tool) | Stateless per execution | Budgeted inlined catalog (round-robin, 2k tokens) + always-on `tools.$codemode.search` | 3 knobs only (`timeoutMs`/`maxToolCalls`/`maxOutputBytes`, all unset by default); 8 concurrent calls; 32-level data depth. Non-goals: approvals, durable pause/resume, replay |
| pi codemode (1.1.0) | **Multi-server**: one QuickJS script calls the session's whole surface incl. every MCP server (`tools.mcp__srv__tool`) | Stateless scripts + `store()`/`load()` small JSON across calls (1M chars total) | BM25 `searchTools()`, `describeTool()`, `describeNamespace()`, `ALL_TOOLS`; MCP tools default to `codemode` (hidden, callable) exposure | 256MB VM, no fs/net/timers, no nested codemode, output caps + temp-file spill, `Promise.allSettled` fan-out |
| Cloudflare browser integration | **Exactly one page**: browser-owned tools in a hidden-iframe executor | None beyond the chat | New descriptor per tool-set change | `needsApproval` tools **excluded** from codemode; timeout can't break `while(true){}`. "Does not give an agent control of a remote browser" |
| MCP spec | **One connection, N servers aggregated client-side**; uniqueness scoped per server, aggregators SHOULD disambiguate (e.g. prefix) | No orchestration state in-spec | `tools/list` + pagination + `listChanged`; deterministic order for prompt-cache hits | No cross-server call primitive. Elicitation = server→user structured input nested in a call (accept/decline/cancel; MUST NOT ask secrets). Sampling = server→client nested LLM call (client keeps model control). Both nest *up* toward the user/model, never *across* to another server |
| WebMCP | **One document tree**: `getTools()` over same-origin frames + `fromOrigins` allowlist; sharing via per-tool `exposedTo` + `allow="tools"` policy | Page-owned; dynamic register/unregister by page state (`toolchange` events) | Per-page `getTools()`; no cross-page catalog | Open questions list has no multi-page item; non-goal: fully autonomous/headless flows. Every Chrome Labs demo (flightsearch, L'Atelier hotel, Sports, Luxe Leather…) is single-site |
| agent-browser (Vercel Labs) | **One active tab**: DOM verbs (snapshot refs `@eN`, click/fill) + `webmcp list/invoke` on that tab | Refs die with the snapshot — re-snapshot before retry | Proactive 16-tool/4KiB summaries on catalog change; full schema on demand (`webmcp list <tool>`) | No cross-tab join; MCP profile splits `core,webmcp`; page metadata labeled `untrusted: true` (provenance cue, "not a prompt-injection boundary") |
| Stagehand / Browserbase | **One page** via `act()`/`extract()`/`observe()` over Playwright; v3 adds parallel multi-browser sessions (infra parallelism, not a join semantic) | Session-per-browser | Agent-inferred, not catalog-driven | No cross-page tool-composition semantic found |

**What NONE of them do:** no system binds tools from N *mutually-distrusting*
origins into one flow with per-origin budgets, hop-by-hop provenance labels,
or cross-origin rollback. Cloudflare is closest on durability (`revert` per
connector = compensation *inside one trust domain*; approvals abort+replay).
pi is closest on multi-server scripting (but servers are operator-configured:
single trust domain, no per-server attenuation). MCP names the aggregation
hazard (prefix on collision) and stops there.

## 2. Trust: what breaks when one flow invokes tools from N distrusting origins

- **Confused deputy across pages (inference, mechanism verified).** Page A's
  output naming page B's tool/args: today `run` binds one handle so the deputy
  is single-page; multi-handle code makes `tools.B.book(await …A…)` the normal
  shape. The ranking half already exists: `search` scores attacker-controlled
  descriptions (word-overlap, name 3x — `src/tools/search.ts:56`), and SKILL.md
  warns a poisoned description can rank first. Cross-page doubles the surface:
  A's text can promote B's tool *and* fill its args. Mitigation on record:
  search→describe→invoke (read schema + origin before invoking), never promote
  page text to instructions (SKILL.md "Untrusted data").
- **Capability attenuation: today impossible (verified pre-merge; the
  mechanism moved — see `src/tools/execute.ts` dispatch + snapshot
  wiring).** A `run` block sees
  the whole frozen snapshot (pre-merge `src/tools/run.ts:66-70`, now
  `src/tools/execute.ts:113-148`: per-alias names sets at start;
  added-mid-run denied, removed-mid-run fails honestly downstream) with full
  operator privilege (`docs/run-accepted-risk.md`: constructor-escape, dynamic
  `import()`, forged completion accepted; caps bind cooperating code only).
  Real models, sourced: macaroons attenuate via chained-HMAC caveats added
  offline by the holder (NDSS'14 "Macaroons: Cookies with Contextual Caveats";
  `research.google/pubs`); Biscuit the same with public-key verification +
  Datalog policies and offline attenuation (`doc.biscuitsec.org`). Our analogue
  would be per-run tool allowlists or session-scoped sub-handles — an unbuilt
  inference, listed as candidate F below.
- **Provenance through multi-hop flows (verified gap).** Each envelope carries
  `{untrusted: true, origin}` per call (`src/sessions/verbs.ts:279-280`
  interface, populated at `:320-321`), but once
  `run` code concatenates A-output into B-args the hop vanishes: the return is
  `{value, spilled, toolCalls, origin}` for *one* session (pre-merge
  `src/tools/run.ts:135`; merged envelope carries `origins[]` +
  `perSession` — the multi-origin honesty this section asks for).
  Neither MCP (`structuredContent` is single-call result data) nor WebMCP
  (`toolchange`/`toolactivated` are lifecycle, not lineage) has a hop primitive —
  sourced absence. Cheapest honest record: multi-origin envelopes listing which
  origins contributed (candidate B), not cryptographic lineage.
- **Prompt-injection blast radius A-output → B-args (inference on sourced parts).**
  B's `execute` cannot tell operator intent from A's injection; page-side
  validation is the backstop ("validate strictly in code, loosely in schema" —
  WebMCP README best practices, sourced). Sourced mitigations we deliberately
  don't take: Cloudflare `requiresApproval` + abort/replay (and the browser
  build *excludes* approval tools); MCP elicitation accept/decline/cancel with
  user review. Non-goal stays non-goal: no opt-in gates for single-operator use.
  Accepted-risk framing carries over from `docs/run-accepted-risk.md`: with one
  operator owning both pages there is no cross-principal attack; multi-tenant
  or beyond-localhost exposure reopens everything (attenuation, gating, real
  isolation).

## 3. Unlocks for our 8 verbs, ranked by value/cost

| # | Candidate | What changes (files/verbs) | Enables (concretely) | Costs |
|---|---|---|---|---|
| 1 | **Per-item `sessionId` in `execute`** | `src/tools/execute.ts`: `calls[]` items each carry own handle; `runSessionBatch` fans out across N sessions on one shared connection each | search-flights-here + book-hotel-there in one batch; compare-prices across two storefronts (Sports + Luxe Leather) in one turn | Smallest surface growth; trust: per-item origins already in envelopes; rollback stays manual (follow-up batch, per-item `ok` flags) |
| 2 | **`search` across MANY sessions** | `src/tools/search.ts`: `handle` → `handles[]`/`--all` (via `listSessions`); results keep `{session, origin}` tags | "find `bookRoom` anywhere" across open pages; pre-flight for candidate 1/3 | Small; trust: poisoned-description ranking now spans origins — contained by existing session/origin tags + describe-before-invoke |
| 3 | **`run` bound to N handles** | `src/tools/run.ts` + `src/codemode/runner.ts`: bridge `invoke` routes per handle (namespaced globals or session objects), per-handle budgets under the 25-call cap (`src/budgets.ts`) | One code block: hold flight → book hotel → on throw, compensate (cancel hold); monitor loop: poll order-tracking on A, reorder on B when status flips | Medium; trust: cross-page deputy becomes expressible — needs multi-origin return envelope + staleness story (candidate 5) |
| 4 | **Staleness surfacing** | `describe`/`list` envelopes + `run` return carry a catalog version; `run` keeps snapshot-freeze (safe direction verified) and reports drift | Mid-flow tool drift × N pages becomes debuggable instead of mysterious | Small; mostly documentation + envelope fields |
| 5 | **Sessions as values in `run`** | Bridge exposes session objects (`sessions.H.tools.*`); `open` inside code stays out (handles enter as args) | Dynamic fan-out: open N property pages, filter in code, return top-3 | Folds into 3's cost; dynamic handle set complicates the snapshot story — do after 3 |
| 6 | **Per-run attenuation (tool allowlist)** | `run` input gains `allow?: string[]`; bridge refuses outside it pre-dial | Least-privilege compose steps (read-only sweep before a write step) | Medium; value unlocks only with multi-tenant use — defer, keep design minimal (list, not crypto) |

**End-to-end flow with a rollback story (against candidates 1+3):**
open flightsearch demo + hotel page → `execute` fans out `searchFlights(SFO→JFK)`
+ `searchRooms(JFK, dates)` → `run` holds a flight, books a room, and on hotel
failure invokes the flight hold-release in `catch` (compensation in code, not
durable — Cloudflare-style `revert`/replay stays out). No cancel tool →
rollback is today's story: report partial + `close --all` (CLI exit codes are
the rollback story; `docs/research/codemode-opencode-vs-cloudflare.md:41`).
Writes-free flows (compare-and-buy) need no rollback and should be the first
proof.

**Explicit non-goals (unchanged):** opt-in approval gates for single-operator
use; durable platform layer (no execution log, replay, snippets, pruning —
Cloudflare's facet is the documented anti-model); filesystem/process sandbox
for `run` beyond accident containment.

## 4. Eval: proving cross-page composition deterministically, no model

Mirror `scripts/eval-mcp.ts` precedent (stdio-spawned `mcp serve`, JSON-RPC,
`check()` lines, exit 1 on any FAIL, zero tokens): new `scripts/eval-xpage.ts`
(`bun run eval:xpage`), JSONL output.

- **Fixtures: two local demo pages, served by bun (no network).** Page F
  (flights: `searchFlights`/`listFlights` + `holdFlight`/`releaseHold` for
  compensation drills); page H (hotel: `searchRooms`/`bookRoom`/`cancelBooking`).
  Localhost satisfies `open`'s http(s) check (`src/sessions/verbs.ts:47`); the
  Chrome ≥149/testing-flag floor (`docs/research/webmcp-codemode.md:83`) applies
  to fixtures too. Public analogues already exercised: Chrome Labs
  `react-flightsearch` (eval-mcp's DEMO) + L'Atelier hotel.
- **Check-list shape (each asserts JSON shape, never model judgment):**
  `open` F + H (handles `s_…`) → multi-session `search` returns both sessions'
  tools tagged → `describe` per session resolves full schemas → `execute` with
  per-item handles fans out (both `ok:true`) → `run` multi-handle joins
  (book-H only if hold-F, asserts branch taken) → **fault injection**: H
  `bookRoom` forced to fail → F `releaseHold` observed (rollback path) →
  oversized cross-page results assert structured `spill` fields (never
  text-regexed paths) → `close --all` asserts both handles released.
- **Determinism rules:** fixed args, seeded fixture data, shape assertions on
  envelopes (`status`/`ok`/`untrusted`/`origin`/session tags); latency-sensitive
  only via existing budget constants (`INVOKE_TIMEOUT_MS`, `RUN_MAX_TOOL_CALLS`).

No demo pages, browsers, or servers were opened for this research (web sources
only) — zero stray processes to close.
