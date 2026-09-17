---
skill: vgpu
title: vgpu
kind: site-agent
description: Work vgpu docs (vgpu.sh/docs) — open the Ask AI panel, ask questions, read settled answers with sources. Use when the task needs vgpu's documentation or assistant answers.
site: [vgpu.sh]
tags: [docs, assistant, vgpu]
tier: official
category: docs
verified: 2026-09-15
updated: 2026-09-15
access: public
verbs: [vgpu_chat_open, vgpu_chat_ask, vgpu_chat_read, vgpu_chat_clear, vgpu_chat_close]
readonly: [vgpu_chat_open, vgpu_chat_read, vgpu_chat_close]
---

# vgpu

Work the Ask AI panel on `vgpu.sh/docs` (login never required): open it,
ask questions, read settled answers with sources. Same panel family as
the `eve` skill — Ask AI trigger, composer plus Submit, "Used N
sources" completion line. No native tools on this tenant (empty `list`)
— the panel is the whole surface.

## Open, ask, close

1. `vgpu_chat_open` — ensure the panel is frontmost. Done when it
   reports `{visible:true}` (plus `{already}` when it was open).
2. `vgpu_chat_ask {question, timeoutMs}` — one question per call.
   Prefer a modest `timeoutMs` (25000–30000) and ask again to poll.
   Done when a call returns `settled:true` with a non-empty answer.
3. Verify the answer against its cited sources before carrying claims.
   Close the panel at task end — closing keeps history, so either
   restate minimal context per task or wipe with `vgpu_chat_clear`
   between unrelated tasks.

Server memory is shared; turns you did not create are foreign. One
question in flight at a time.

## Tool reference

- `vgpu_chat_open` — Open the panel. No-op when open.
- `vgpu_chat_ask {question, timeoutMs?}` — Talk to the agent. Returns
  `{question, answer, settled, sourcesUsed, accepted}`. Completion is
  the "Used N sources" line plus stable text. Recovery: `settled:false`
  → ask again, then narrower; error text → report it, one retry max.
- `vgpu_chat_read` — Read-only poll. Latest transcript without sending.
- `vgpu_chat_clear` — Wipe the thread via "Clear chat" (disabled while
  empty = no-op). Server-side — cleared turns stay gone. Acts-grade:
  call between tasks, never mid-task.
- `vgpu_chat_close` — Close the panel. Closing keeps history.

## Coverage

- Supported: panel conversation (open/ask/read/clear/close) headful.
  Grounded 2026-09-15, vgpu.sh/docs.
- Known, not covered: no natives on this tenant; headless unverified
  (family experience says panels stall — use `--headed` until proven).
  Page-level extras ("Copy page", "Copy for LLM") are not verbs.
- Unknown: mobile entry.

## Troubleshooting

- `settled:false` twice → ask narrower, report both readouts.
- `submit control not armed` → type again; Submit enables
  asynchronously after input lands.
- Foreign turns → shared server memory; restate minimal context or
  clear first.

## Examples

- Live 2026-09-15 (headful): "What is vgpu, in one sentence?" →
  "Used 8 sources" + "vgpu is an agentic-first WebGPU library designed
  for Node.js, browsers, and serverless runtimes, providing a
  structured and composable API for GPU programming."
