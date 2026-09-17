---
skill: eve
title: Eve
kind: site-agent
description: Work Eve docs (eve.dev/docs) — open the Ask AI dock, ask questions, read settled answers with sources. Use when the task needs Eve's documentation or assistant answers.
site: [eve.dev]
tags: [docs, assistant, eve]
tier: official
category: docs
verified: 2026-09-15
updated: 2026-09-15
access: public
verbs: [eve_chat_open, eve_chat_ask, eve_chat_read, eve_chat_clear, eve_chat_close]
readonly: [eve_chat_open, eve_chat_read, eve_chat_close]
---

# Eve

Work the Ask AI dock on `eve.dev/docs` (login never required): open it,
ask questions, read settled answers with sources. Custom panel family
(not Mintlify) — composer plus Submit, suggestion chips, "Used N
sources" completion line. Natives (`search_docs`, `read_current_page`)
ship with the page and are strong — prefer them for lookup; use the
dock for synthesized answers.

## Open, ask, close

1. `eve_chat_open` — ensure the dock is frontmost. Done when it reports
   `{visible:true}` (plus `{already}` when it was open).
2. `eve_chat_ask {question, timeoutMs}` — one question per call. Prefer
   a modest `timeoutMs` (25000–30000) and ask again to poll. Done when a
   call returns `settled:true` with a non-empty answer. Short answers
   settle fast — small growth past baseline is normal, check content.
3. Verify the answer against its cited sources before carrying claims.
   Close the dock at task end — closing keeps history, so either
   restate minimal context per task or wipe with `eve_chat_clear`
   (local sheet wipe) between unrelated tasks.

Server memory is shared; turns you did not create are foreign. One
question in flight at a time.

## Tool reference

- `eve_chat_open` — Open the dock. No-op when open.
- `eve_chat_ask {question, timeoutMs?}` — Talk to the agent. Returns
  `{question, answer, settled, sourcesUsed, accepted}`. Completion is
  the "Used N sources" line plus stable text, not the send. Recovery:
  `settled:false` → ask again, then narrower; error text → report it,
  one retry max.
- `eve_chat_read` — Read-only poll. Latest transcript without sending;
  the recovery path when a long `ask` loses its return.
- `eve_chat_clear` — Wipe the sheet via "Clear chat" (disabled while
  empty = no-op). LOCAL wipe — close+reopen re-seats the last server
  turn (proven on chat-sdk; eve re-check pending). Clean sheet, not a
  privacy boundary. Acts-grade: call between tasks, never mid-task.
- `eve_chat_close` — Close the dock. Closing keeps history.
- `search_docs {query}` — search docs with highlighted excerpts + page
  URLs (native). Verified — prefer for lookup.
- `read_current_page` — full current page as Markdown (native).
  Verified — prefer for reading.

## Coverage

- Supported: dock conversation (open/ask/read/clear/close) headful,
  both natives. Grounded 2026-09-15, eve.dev/docs.
- Known, not covered: headless unverified on this tenant (family
  experience says panels stall — use `--headed` until proven).
- Unknown: mobile entry, Expand chat behavior.

## Troubleshooting

- `settled:false` twice → ask narrower, report both readouts.
- `submit control not armed` → type again; the composer enables
  Submit asynchronously after input lands.
- Short answer with tiny growth → normal here; check the "Used N
  sources" line, not the char delta.
- Foreign turns → shared server memory; restate minimal context or
  clear first.

## Examples

- Live 2026-09-15 (headful): "What are Eve channels, in one sentence?"
  → "Used 6 sources" + "Eve channels connect your agent to external
  clients and services, handling platform-specific communication such
  as Slack messages or MCP requests."
