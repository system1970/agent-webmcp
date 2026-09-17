---
skill: exa
title: Exa
kind: site-agent
description: Work Exa docs (exa.ai/docs) — ask the Ask Assistant via its inline bar, read settled answers with sources. Use when the task needs Exa's documentation or assistant answers.
site: [exa.ai]
tags: [docs, assistant, exa]
tier: official
category: docs
verified: 2026-09-16
updated: 2026-09-16
access: public
verbs: [exa_chat_open, exa_chat_ask, exa_chat_read, exa_chat_clear, exa_chat_close]
readonly: [exa_chat_open, exa_chat_read, exa_chat_close]
---

# Exa

Work the Ask Assistant on `exa.ai/docs` (login never required): ask
questions through its inline entry bar, read settled answers with
sources. Mintlify backend family with a triggerless entry — no open
button exists; the panel opens on the first send. Natives
(`open_skill`, `search_docs`) ship with the page. Headful session
required.

## Open, ask, close

1. `exa_chat_open` — read-only status check (never clicks — there is
   no trigger). Done when it reports `{barPresent:true}` (ready to
   ask) with `visible` telling whether the panel is already up.
2. `exa_chat_ask {question, timeoutMs}` — one question per call. The
   first call opens the panel via the inline bar automatically.
   Prefer a modest `timeoutMs` (25000–30000) and ask again to poll.
   Done when a call returns `settled:true` with a non-empty answer.
3. Verify the answer against its cited sources before carrying claims.
   Close the panel at task end — closing keeps history, so either
   restate minimal context per task or wipe with `exa_chat_clear`
   between unrelated tasks.

Server memory is shared; turns you did not create are foreign. One
question in flight at a time.

## Tool reference

- `exa_chat_open` — Status check. No-op by design (no trigger on
  this tenant). Reports `{visible, barPresent, already}`.
- `exa_chat_ask {question, timeoutMs?}` — Talk to the agent. Returns
  `{question, answer, settled, streaming, sourcesUsed, accepted}`.
  Completion is `settled:true`, not the send. Recovery:
  `settled:false` → ask again, then narrower; `send control not
  armed` → the bar kept prior text; clear it and ask again, one
  retry max.
- `exa_chat_read` — Read-only poll. Latest transcript without
  sending; the recovery path when a long `ask` loses its return.
- `exa_chat_clear` — Wipe the thread via "Clear chat history".
  SERVER-SIDE here (proven 2026-09-16). Acts-grade: call between
  tasks, never mid-task.
- `exa_chat_close` — Close the panel. Closing keeps history; reopen
  by asking again.
- `open_skill {skill_name}` — open a skill document (native). Verify
  live before relying on it.
- `search_docs {query}` — search docs pages (native). 500s in
  September — retry before trusting.

## Coverage

- Supported: panel conversation (open/ask/read/clear/close) headful.
  Grounded 2026-09-16, exa.ai/docs.
- Known, not covered: `search_docs` health; headless (family trait
  says it stalls — use `--headed` until proven); attachment control.
- Unknown: mobile entry.

## Troubleshooting

- Empty answer with `streaming:true` → still generating; ask again.
- `settled:false` twice → ask narrower, report both readouts.
- `send control not armed` → stale bar text; the ask verb's
  empty-first arming handles it — one retry, then report.
- Foreign turns → shared server memory; restate minimal context or
  clear first.

## Examples

- Live 2026-09-16 (headful): "What is Exa Search?" → settled with
  "Read 1 file" + "Exa Search is a web search API built for AI agents
  ..." plus source links (Search Quickstart, Deep Search, Get
  Started).
