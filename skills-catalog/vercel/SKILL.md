---
skill: vercel
title: Vercel
kind: site-agent
description: Work Vercel docs (vercel.com/docs) — open the Ask AI panel, ask questions, read settled answers with sources. Use when the task needs Vercel documentation or assistant answers.
site: [vercel.com]
tags: [docs, assistant, vercel]
tier: official
category: docs
verified: 2026-09-15
updated: 2026-09-15
access: public
verbs: [vercel_chat_open, vercel_chat_ask, vercel_chat_read, vercel_chat_clear, vercel_chat_close]
readonly: [vercel_chat_open, vercel_chat_read, vercel_chat_close]
---

# Vercel

Work the Ask AI panel on `vercel.com/docs` (login never required):
open it, ask questions, read settled answers with sources. Same panel
family as the `eve` skill — Ask AI trigger, composer plus Submit,
"Used N sources" completion line. No native tools on this tenant —
the panel is the whole surface.

## Open, ask, close

1. `vercel_chat_open` — ensure the panel is frontmost. Done when it
   reports `{visible:true}` (plus `{already}` when it was open).
2. `vercel_chat_ask {question, timeoutMs}` — one question per call.
   Prefer a modest `timeoutMs` (25000–30000) and ask again to poll.
   Done when a call returns `settled:true` with a non-empty answer.
3. Verify the answer against its cited sources before carrying claims.
   Close the panel at task end — closing keeps history, so either
   restate minimal context per task or wipe with `vercel_chat_clear`
   between unrelated tasks.

Server memory is shared; turns you did not create are foreign. One
question in flight at a time.

## Tool reference

- `vercel_chat_open` — Open the panel. No-op when open.
- `vercel_chat_ask {question, timeoutMs?}` — Talk to the agent. Returns
  `{question, answer, settled, sourcesUsed, accepted}`. Completion is
  the "Used N sources" line plus stable text. Recovery: `settled:false`
  → ask again, then narrower; error text → report it, one retry max.
- `vercel_chat_read` — Read-only poll. Latest transcript without
  sending.
- `vercel_chat_clear` — Wipe the thread via "Clear chat". SERVER-SIDE
  on this tenant (proven: history survives close+reopen, clear removes
  it). Acts-grade: call between tasks, never mid-task.
- `vercel_chat_close` — Close the panel. Closing keeps history.

## Coverage

- Supported: panel conversation (open/ask/read/clear/close) headful.
  Grounded 2026-09-15, vercel.com/docs.
- Known, not covered: no natives on this tenant; headless unverified
  (family experience says panels stall — use `--headed` until proven).
  Page extras ("Copy prompt", "Copy chat as markdown") are not verbs.
- Unknown: mobile entry.

## Troubleshooting

- `settled:false` twice → ask narrower, report both readouts.
- `submit control not armed` → type again; Submit enables
  asynchronously after input lands.
- Foreign turns → shared server memory; restate minimal context or
  clear first.

## Examples

- Live 2026-09-15 (headful): "What is Vercel Fluid, in one sentence?"
  → "Used 8 sources" + "Vercel Fluid Compute is a hybrid serverless
  model that combines serverless flexibility with server-like
  performance by allowing multiple concurrent requests to share a
  single function instance, eliminating cold starts and reducing
  costs."
