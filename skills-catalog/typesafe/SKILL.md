# typesafe — Ask Assistant site agent

Talk to the TypeSafe docs assistant (https://docs.typesafe.ai) through its Ask Assistant panel.

## Verbs (via `invoke --session <s>`)

- `typesafe_chat_open` (read-only) — open the panel. Open = `.chat-assistant-sheet` wider than 100px (the composer persists sized while closed — never gate on it). No-op when open. Note: panel auto-opens on nav.
- `typesafe_chat_ask` — SEND ONLY. Returns `{question, accepted:true}` in under a second, then ALWAYS poll `typesafe_chat_read` until the answer stops growing. A subframe on this tenant navigates every few seconds; any held execution dies with "cross-origin navigation". Never wait inside ask.
- `typesafe_chat_read` (read-only) — transcript poll. Never mutates.
- `typesafe_chat_clear` — honest no-op (`already:true`): no clear control exists on this panel, with or without history. Fresh session per unrelated task.
- `typesafe_chat_close` (read-only) — close via "Close assistant panel". Verified `{closed:true}`.

## Install

```
agent-webmcp tools add overlay.js --for docs.typesafe.ai
agent-webmcp open https://docs.typesafe.ai/introduction/quickstart --session <s> --headed
agent-webmcp invoke typesafe_chat_ask --session <s> --params '{"question":"..."}'
# ...poll typesafe_chat_read until stable...
```

Headful recommended. Natives on tenant: `open_skill` (works), `search_docs` (500s — route around via panel).
