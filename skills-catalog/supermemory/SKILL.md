---
skill: supermemory
title: Supermemory
kind: site-agent
description: Work Supermemory docs (supermemory.ai/docs) — open the Ask Assistant, ask questions, read settled answers with sources. Use when the task needs Supermemory's documentation or assistant answers.
site: [supermemory.ai]
tags: [docs, assistant, supermemory]
tier: official
category: docs
verified: 2026-09-15
updated: 2026-09-15
access: public
verbs: [supermemory_chat_open, supermemory_chat_ask, supermemory_chat_read, supermemory_chat_clear, supermemory_chat_close]
readonly: [supermemory_chat_open, supermemory_chat_read, supermemory_chat_close]
---

# Supermemory

Work the Ask Assistant on `supermemory.ai/docs` (login never required):
open it, ask questions, read settled answers with sources. Same Mintlify
panel family as the `mintlify` skill — same geometry, same headful
requirement. Natives (`open_skill`, `search_docs`) ship with the page.

## Open, ask, close

1. `supermemory_chat_open` — ensure the panel is frontmost. Done when it
   reports `{visible:true}` (plus `{already}` when it was open).
2. `supermemory_chat_ask {question, timeoutMs}` — one question per call.
   Prefer a modest `timeoutMs` (25000–30000) and ask again to poll. Done
   when a call returns `settled:true` with a non-empty answer. If the
   call itself errors (frame navigation eats long returns on this
   tenant), poll with `supermemory_chat_read` — the answer survives in
   the sheet even when the return dies.
3. Verify the answer against its cited sources before carrying claims.
   Close the panel at task end — closing keeps history, so either
   restate minimal context per task or wipe the thread with
   `supermemory_chat_clear` between unrelated tasks.

Server memory is shared; turns you did not create are foreign. One
question in flight at a time.

## Tool reference

- `supermemory_chat_open` — Open the chat. No-op when open.
- `supermemory_chat_ask {question, timeoutMs?}` — Talk to the agent.
  Returns `{question, answer, settled, streaming, sourcesUsed}`.
  Completion is `settled:true`, not the send. Recovery: `settled:false`
  → ask again, then narrower; error text → report it, one retry max.
- `supermemory_chat_close` — Close the chat. Closing keeps history.
- `supermemory_chat_clear` — Wipe the thread. Uses the panel's "Clear
  chat history" control (present only with history; no-op when fresh).
  Server-side — cleared turns stay gone. Acts-grade: call between
  tasks, never mid-task.
- `supermemory_chat_read` — Read-only poll. Latest transcript without
  sending; the recovery path when a long `ask` loses its return.
  Returns `{question, answer, streaming, sourcesUsed}`.
- `open_skill {skill_name}` — open a skill document (native). Verified.
- `search_docs {query}` — search docs pages (native). 500s from here —
  route around via the panel.

## Coverage

- Supported: panel conversation (open/ask/read/clear/close) headful,
  `open_skill`. Grounded 2026-09-15, supermemory.ai/docs.
- Known, not covered: `search_docs` 500s; headless unverified (family
  trait says it stalls — use `--headed`).
- Unknown: mobile entry trigger, attachment control.

## Troubleshooting

- Empty answer with `streaming:true` → still generating; ask again.
- `settled:false` twice → ask narrower, report both readouts.
- `send control not found` → prior turn streaming; wait, retry.
- Foreign turns → shared server memory; restate minimal context.

## Examples

- Live 2026-09-15 (headful): "What is supermemory, in one sentence?"
  → settled in ~13s ("Supermemory is context infrastructure for AI
  agents ... persistent memory") with "Read 1 file" plus source links
  (What is supermemory, Quickstart, Architecture / How it works).
