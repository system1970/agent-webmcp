---
skill: flags-sdk
title: Flags SDK
kind: site-agent
description: Work Flags SDK docs (flags-sdk.dev/docs) — open the Ask AI panel, ask questions, read settled answers with sources. Use when the task needs Flags SDK documentation or assistant answers.
site: [flags-sdk.dev]
tags: [docs, assistant, flags]
tier: official
category: docs
verified: 2026-09-15
updated: 2026-09-15
access: public
verbs: [flags_chat_open, flags_chat_ask, flags_chat_read, flags_chat_clear, flags_chat_close]
readonly: [flags_chat_open, flags_chat_read, flags_chat_close]
---

# Flags SDK

Work the Ask AI panel on `flags-sdk.dev/docs` (login never required):
open it, ask questions, read settled answers with sources. Same panel
family as the `eve` skill — Ask AI trigger, composer plus Submit,
"Used N sources" completion line. No native tools on this tenant —
the panel is the whole surface.

## Open, ask, close

1. `flags_chat_open` — ensure the panel is frontmost. Done when it
   reports `{visible:true}` (plus `{already}` when it was open).
2. `flags_chat_ask {question, timeoutMs}` — one question per call.
   Prefer a modest `timeoutMs` (25000–30000) and ask again to poll.
   Done when a call returns `settled:true` with a non-empty answer.
3. Verify the answer against its cited sources before carrying claims.
   Close the panel at task end — closing keeps history, so either
   restate minimal context per task or wipe with `flags_chat_clear`
   between unrelated tasks.

Server memory is shared; turns you did not create are foreign. One
question in flight at a time.

## Tool reference

- `flags_chat_open` — Open the panel. No-op when open.
- `flags_chat_ask {question, timeoutMs?}` — Talk to the agent. Returns
  `{question, answer, settled, sourcesUsed, accepted}`. Completion is
  the "Used N sources" line plus stable text. Recovery: `settled:false`
  → ask again, then narrower; error text → report it, one retry max.
- `flags_chat_read` — Read-only poll. Latest transcript without
  sending.
- `flags_chat_clear` — Wipe the thread via "Clear chat" (disabled
  while empty = no-op). SERVER-SIDE on this tenant (proven: history
  survives close+reopen, clear+close+reopen leaves suggestions only).
  Acts-grade: call between tasks, never mid-task.
- `flags_chat_close` — Close the panel. Closing keeps history.

## Coverage

- Supported: panel conversation (open/ask/read/clear/close) headful.
  Grounded 2026-09-15, flags-sdk.dev/docs.
- Known, not covered: no natives on this tenant; headless unverified
  (family experience says panels stall — use `--headed` until proven).
  Page-level extras ("Copy page", "Copy for LLM", "Copy prompt
  actions", "Copy code") are not verbs.
- Unknown: mobile entry, Expand chat behavior.

## Troubleshooting

- `settled:false` twice → ask narrower, report both readouts.
- `submit control not armed` → type again; Submit enables
  asynchronously after input lands.
- Foreign turns → shared server memory; restate minimal context or
  clear first.

## Examples

- Live 2026-09-15 (headful): "What is flags-sdk, in one sentence?" →
  "Used 8 sources" + "The Flags SDK is a free, open-source library
  for using feature flags in Next.js and SvelteKit applications."
