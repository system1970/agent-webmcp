---
name: site-forge
description: Forge a site skill the hard way: drive the live page with raw CLI verbs first, harden the CLI from what hurts, then compile the proven path into overlay verbs plus SKILL.md plus evals.json. Use when building or repairing any skills-catalog entry. No green skills test, no ship; red stays a stub.
---

# Site-forge

CLI first, skill second, meta notes always. Every site run improves three
things: the CLI toolset, the site's skill, and this file.

## Phase 1 — Raw turn (zero hand-written JS)

`sessions` → reuse or `open <url> --session <name> --desc "site + purpose"`.
Then natives first (`list`: a native tool ends the whole job — no overlay
for what's already a tool), then UI (`scan` → `act` → `read` → `wait`).

- Baseline chars BEFORE acting; shell round-trips outlive answers.
- One action per `act`; refs re-grounded every `scan` (`'@eN'` quoted).
- `wait --for stable --baseline <n> --min-growth 50`; the readout is
  ground truth, the return is not.
- `trace on` before the turn, `trace dump --api` after — XHR/fetch hits
  are API-first candidates the overlay should prefer over DOM replay.

## Phase 2 — Harden the CLI from what hurt

Every friction in the raw turn is a CLI gap until proven otherwise.
Fix it in `cmd/agent-webmcp/` before compiling the skill:

- Silent parses (`Sscanf` keeping old values) → `parseInt` + clear error.
- Panic-prone assertions on page JSON → `strField` safe extraction.
- Stringly-typed envelopes → real structs (`WebMCPStatus`, `ErrorCode`).
- Long fragile waits inside one call → short calls + CLI-side polling.
- `go vet` + `go test` + rebuild before the next live touch.

## Phase 3 — Compile the skill

`skills-catalog/<skill>/` gets exactly three files:

- `overlay.js` — async IIFE via the page's own `document.modelContext`.
  Fixed verbs only, grounding queries never cached nodes, no selector the
  raw turn didn't prove. `[agent overlay]` labels; read-only markings.
- `SKILL.md` — manual: purpose+hosts, open→ask→close with completion
  criteria, per-verb contracts, Supported / Known-not-covered / Unknown,
  troubleshooting from observed failures, labeled live examples. Concrete
  verb names in frontmatter, `verified:` null until green.
- `evals.json` — `{page, date, verdict, checks:[{verb, params,
  expect:{contains}, timeoutMs}]}`. Natives get checks too.

Load for real: `tools add --for <host>` → REAL navigation (different URL,
then target) → `list` shows new descriptions → `skills test` green →
set `verified:`. Red stays `verbs: []` with no overlay/evals (stub).

## Ledger (learned hard — append, never rewrite)

- 2026-09-15 mintlify: panel accepts sends headless but answers never
  stream (30s zero growth, Stop present, echo-only sheet). Headed renders
  ~8-10s with sources. Lesson: verify the MODE, not just the verbs;
  record headful-required in the skill when headless stalls.
- 2026-09-15 mintlify: trigger label identical open/closed ("Toggle
  assistant panel"). Lesson: gate open-state on geometry (sheet +
  composer sized + Send/Stop), never on labels.
- 2026-09-15 mintlify: send disabled until text lands via native setter +
  input event. Lesson: receipts before clicks — check armed state after
  every type, frameworks enable submits asynchronously.
- 2026-09-15 mintlify: settle = stream-signal gone AND text stable twice;
  strip panel chrome before comparing. Suggestions match error regexes —
  scope reads to the transcript root.
- 2026-09-15 mintlify: `POST leaves.mintlify.com/api/assistant/mintlify/message`
  (200, ~4.7s) carries the turn — unproven direct substitute, queued.
- 2026-09-15 exa.ai: same stall signature (echo, no stream, no Send
  control at all) + `search_docs` 500. Stays stubbed until a headed turn
  proves otherwise.
- 2026-09-15 harness: long single invokes die on frame navigation
  ("Cannot return tool results after a cross-origin navigation") while
  CLI-side poll loops survive. Lesson: keep page-tool calls short;
  poll from the CLI; re-running the check after nav fallout is valid.
- 2026-09-15 supermemory: overlay ask's RETURN died while its WORK
  landed (answer in sheet, sources attached). Fix is a read-only
  `*_chat_read` recovery verb + evals that check accepted-send
  separately from read-poll content. Lesson: separate mutation from
  observation in overlay design; never let one orphaned return fail
  the whole turn.
- 2026-09-15 tooling: `tools add` then `open` re-installs catalog bytes
  OVER manual packs when the binary's embed lags the tree. Lesson:
  rebuild BEFORE `tools add` whenever catalog sources changed; then
  real-nav reload, then `list`, then test.
- 2026-09-15 runner: back-to-back checks orphan on panel animation
  (ask dies ~100ms after open). Fix: 1.5s settle between
  `skills test` checks (`skills_catalog.go`). Lesson: the verifier
  must respect the same settle physics as the verbs.
- 2026-09-15 family: `POST leaves.mintlify.com/api/assistant/<tenant>/message`
  carries every Mintlify-family turn (tenant in path). Unproven direct
  substitute on both tenants; queued for API-first synthesis.
- 2026-09-15 clear: a "Clear chat history" control existed on BOTH
  tenants while two surveys missed it — it renders only while history
  exists. Raw click → suggestions state → close+reopen confirms
  server-side wipe. Added `*_chat_clear` (acts-grade) to both skills;
  overturned the inherited "history survives, no clear" claim by
  testing instead of copying. Lesson: survey controls in EVERY panel
  state (fresh, history, streaming), and re-verify inherited claims
- 2026-09-16 exa: triggerless Mintlify-family entry (no open button;
  inline INPUT bar opens the panel on first send). Hardest arming yet:
  sends stay disabled until React accepts text — recipe is empty-bar
  FIRST, then focus + native setter + input + change (setter without
  change, or typing into a dirty bar, silently fails). Force-enabling
  the button does nothing (handler guards on state). Backend POST
  leaves.mintlify.com/api/assistant/exa-52/message: Mintlify v2 is
  DOCUMENTED replayable (api.mintlify.com/discovery/v2). 5/5 green.
  Side findings: multi-tab sessions make every verb silently hit the
  first page target (need a `tabs` verb); `tools remove` never
  unregisters live tools (stored files only).
- 2026-09-15 vercel: the long debug (open/ask/clear dead, read alive,
  ~5.1s each = ensureOpen's full loop). Root causes, TWO stacked:
  (1) panel docks OFF-CANVAS when closed while the composer keeps its
  size — size alone is not an open signal; gate on viewport geometry
  (rect.x + w within innerWidth). (2) composer placeholder swaps by
  panel state ("Ask a question..." vs "What would you like to know?")
  — match placeholder SETS, never one string. Found via probe tools
  with fresh names (zz_probe_*): pure-return/read/click probes passed,
  verbatim-body probe failed, predicate-dump probe showed hasTA:false
  — bisect live, never guess. Companion lesson: `tools remove` does
  NOT unregister live tools (stored files only) — re-add reports
  Duplicate until a real nav; always bounce before testing overlay
  edits. Vercel backend: POST vercel.com/api/ai-chat (+title) —
  different path shape from the family's /api/chat. 5/5 green.
- 2026-09-15 eve: custom family (Ask AI dock + Submit + "Used N
  sources" completion line). Natives FIRST: search_docs (highlights)
  and read_current_page (full Markdown) end lookup jobs with zero UI.
  Settle = sources line + stable twice; short answers mean small
  growth is normal — check content, not deltas. Backend POST
  eve.dev/api/chat (200, 6KB, ~5.3s): third API lead. 6/6 green
  first try. Lesson: completion signals are per-family — ground the
  marker before writing waitSettled.
- 2026-09-15 panel state check (chat-sdk): after clear+close+reopen,
  the PRIOR answer was still in the sheet — clear wipes the sheet but
  close+reopen re-seats the last server turn (clear button armed again
  = history still server-side). CORRECTION: clear is a LOCAL wipe on
  this family, not server-side — the family claim was overstated.
  Lesson: the close+reopen probe distinguishes local wipe from server
  wipe; run it before writing "stays gone" in any manual.
- 2026-09-15 vgpu: same panel family as eve (Ask AI + Submit + sources
  line), cloned overlay with a prefix swap and re-grounded live — but
  NO natives (empty list) and page-level extras left out of verbs.
  5/5 green first try. Backend POST vgpu.sh/api/chat: same
  first-party /api/chat shape as eve.dev. Lesson: families clone
  fast, but re-ground every selector live and record tenant deltas
  (natives, extras) — never ship a pure rename.
- 2026-09-15 chat-sdk: clone with TWO corrections. (1) Clear is LOCAL
  here, not server-side: close+reopen re-seats the last server turn
  (clear button re-arms). Downgraded every `*_chat_clear` manual on
  the family from "stays gone" to "clean sheet, not privacy" until
  each tenant passes the close+reopen probe. (2) ASIDE-scoped reads:
  document-wide transcript reads hit stale page text and ghosts, and
  the false reports cascade into clear/close failures. Fix in the eve
  overlay too. 5/5 green. Backend POST chat-sdk.dev/api/chat:
  `/api/chat` now on FOUR tenants.
- 2026-09-15 workflow-sdk: third clone of the eve family, fastest yet
  (survey-to-green in one pass). 5/5 first try. Backend POST
  workflow-sdk.dev/api/chat: `/api/chat` now confirmed on three
  tenants (eve, vgpu, workflow-sdk) — synthesis target: POST
  {tenant}/api/chat with a shared turn shape.
- 2026-09-17 prism (read grade): thread rows are DIV[role=button]
  (scope row queries to role, not tag); Radix ignores bare el.click()
  everywhere (avatar menus, thread rows) — focus + pointerdown/
  pointerup/click + VERIFY state after (aria-expanded, panel
  geometry). Settings has no route (404) — it's a view behind the
  avatar menu. Model picker options read without selecting (user's
  6 Astra / Extra high preserved).
- 2026-09-17 tooling: tools that navigate (location.href) orphan the
  page registry — subsequent invokes fail "not found" until the next
  CLI open. Fix: reinjectSession() (tools.go) reloads stored packs
  into the live tab; invoke + skills-test retry once after re-inject
  + target re-resolve (main.go, skills_catalog.go). Proven live:
  prism evals flow home → open_project (nav) → project reads, 6/6.
  Lesson: navigation is a registry-death event — heal it in the
  harness, never hand-bounce.
- 2026-09-17 prism (act grade, approved probe): New-chat-tab button
  creates a fresh "New chat" tab in the strip (verified in list);
  opening it shows an empty composer. Composer is "Ask anything"
  textarea; submit is an icon-only round button
  (bg-button-primary-bg, svg, no aria-label) beside it — ground by
  position (last button in composer scope), never by label. act type
  lands text with no arming fight (unlike exa). Send → settled answer
  ("Got it — I'll ignore this thread"), single occurrence (fresh
  thread confirmed, old threads untouched). Model tag "6 Astra /
  Extra high" echoes beside the reply — free completion marker.
