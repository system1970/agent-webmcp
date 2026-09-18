# lab — Jev experiment harness

Isolates Jev latency from browser overhead (`jev_ping.py`) and runs the
generalizing browser-use battery (`mini_loop.mjs`, zero-dep Jev+Mercury loop).

## Setup

```bash
set -a; source ~/agent-webmcp/.env.local; set +a  # TYPESAFE_API_KEY + text-helper vars
```

Keys live in `.env.local` (git-ignored) — see `.env.example` for the full var
list. Text helper is Mercury via Inception (`TEXT_MODEL_*`); the Nous key is
out of balance, do not use it for the text helper.

Remote browsers: `mini_loop.mjs --cdp-url <ws-url>` (no local Chrome needed).

## Task battery (`TASKS.md`)

All goals are read-only. Run template:

```
node mini_loop.mjs --session <name> --trace traces/<n>.jsonl --url <URL> --goal "<goal>" --max-steps 16
```

Every run appends `traces/*.jsonl` evidence and should append findings to
`OBSERVATIONS.md`. Open threads live in `HANDOFF.md` — claim one before
starting, close it when the trace lands.

## Custom tool sources (`custom-tools/`)

`hn.js` + `wx.js` are verified. Chat shims (`mintlify/shopify/vgpu-chat.js`)
are reference sources — re-verify live before trusting (sites drift).
Register: `agent-webmcp tools add <file> --for <host>`, then `tools verify`.
`ts.js` is still unauthored; validated selectors are in `HANDOFF.md`.
