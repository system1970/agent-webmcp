---
skill: mintlify
title: Mintlify
kind: site-agent
description: Work Mintlify docs (mintlify.com/docs) — open the Ask Assistant panel, ask questions, read settled answers with sources. Use when the task needs Mintlify's documentation or assistant answers.
site: [mintlify.com]
tags: [docs, assistant, mintlify]
tier: official
category: docs
verified: 2026-09-15
updated: 2026-09-15
access: public
verbs: [mintlify_chat_open, mintlify_chat_ask, mintlify_chat_clear, mintlify_chat_close]
readonly: [mintlify_chat_open, mintlify_chat_close]
---

# Mintlify

Work the Ask Assistant panel on `mintlify.com/docs` (login never required):
open it, ask questions, read settled answers with sources. Natives
(`open_skill`, `search_docs`) ship with the page itself. Headful session
required — headless accepts sends but answers never stream.

## Open, ask, close

1. `mintlify_chat_open` — ensure the panel is frontmost. Done when it
   reports `{visible:true}` (plus `{already}` when it was open).
2. `mintlify_chat_ask {question, timeoutMs}` — one question per call.
   Prefer a modest `timeoutMs` (25000–30000) and ask again to poll. Done
   when a call returns `settled:true` with a non-empty answer.
3. Verify the answer against the docs it cites (trailing source links, or
   `open_skill` for the underlying document) before carrying claims
   further. Close the panel at task end — closing keeps history, so
   either restate minimal context per task or wipe the thread with
   `mintlify_chat_clear` between unrelated tasks.

Server memory is shared across sessions; turns you did not create are
foreign. One question in flight at a time.

## Tool reference

Four overlay verbs (open → ask → clear → close) plus the page's own natives:

- `mintlify_chat_open` — Open the chat. Ensures the panel is frontmost and visible; reports `{already}`, no-op when open.
- `mintlify_chat_ask {question, timeoutMs?}` — Talk to the agent. Asks one question and waits for the settled answer; returns `{question, answer, settled, streaming, sourcesUsed}`. Completion is `settled:true`, not the send. Recovery: `settled:false` → ask again, then narrower; error text → report it, one retry max.
- `mintlify_chat_clear` — Wipe the thread. Uses the panel's "Clear chat
  history" control (present only with history; no-op when fresh).
  Server-side — cleared turns stay gone. Acts-grade (destroys thread
  content): call between tasks, never mid-task.
- `mintlify_chat_close` — Close the chat. Dismisses the panel via its toggle; closing keeps history.
- `open_skill {skill_name}` — open a skill document (native, no overlay). Verified live.
- `search_docs {query}` — search docs pages (native, no overlay). 500s from here — route around via the panel.

## Coverage

- Supported: panel conversation (open/ask/clear/close) headful,
  skill-document lookup via `open_skill`. Grounded 2026-09-15,
  mintlify.com/docs.
- Known, not covered: `search_docs` fails from here (500s, retried);
  headless sessions stall (send echoes, no stream — use `--headed`);
  `app.mintlify.com` dashboard (open-ended acting surface, needs a
  locate/act runtime before verbs earn their place).
- Unknown: mobile entry trigger, attachment control.

## Troubleshooting

- Empty answer with `streaming:true` → still generating; ask again to poll.
- `settled:false` twice → ask narrower, then report the stall with both
  readouts.
- `send control not found` → a prior turn is streaming (Stop present);
  wait for settle, then retry.
- Stale turns you did not create → shared server memory; restate minimal
  context.

## Examples

- Live 2026-09-15 (headful): "What is the contextual menu, in one
  sentence?" → settled in ~10s with a grounded one-liner plus source
  links (Contextual menu, Settings structure - contextual).
- Live 2026-09-15 (headful): "Where do I configure the contextual menu?"
  → settled in ~8s ("contextual object under docs.json ... per-page
  frontmatter").
