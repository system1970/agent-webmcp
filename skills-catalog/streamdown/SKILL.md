# streamdown — Ask AI site agent

Talk to the Streamdown docs assistant (https://streamdown.ai) through its Ask AI panel.

## Verbs (via `invoke --session <s>`)

- `streamdown_chat_open` (read-only) — open the panel. No-op when open.
- `streamdown_chat_ask` — ask one question, wait for the settled answer. Params: `{question, timeoutMs}` (25000 recommended, then poll). Returns `{question, answer, settled, sourcesUsed, accepted}`.
- `streamdown_chat_read` (read-only) — latest transcript without sending. Recovery poll.
- `streamdown_chat_clear` — wipe the thread between unrelated tasks. Server-side.
- `streamdown_chat_close` (read-only) — close the panel. History survives; clear first to wipe.

## Install

```
agent-webmcp tools add overlay.js --for streamdown.ai
agent-webmcp open https://streamdown.ai --session <s> --headed
agent-webmcp invoke streamdown_chat_ask --session <s> --params '{"question":"...","timeoutMs":25000}'
```

Headful recommended (same panel family as mintlify/vercel: headless may stall streaming).
Completion marker: the "Used N sources" line plus stable text.
