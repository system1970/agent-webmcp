# Handoff — Jev browser-use session, 2026-09-18

## What landed (3 commits on `main`)

1. **Executor hardening** (`cmd/agent-webmcp/{act,decide,jev,observe,run,tick}.go`):
   stable-key identity (fid/href/placeholder/name), value-aware fingerprints,
   scroll-first geometry with occlusion retries, detached-node re-resolution,
   domSet fallback for stalled input, visited-URL memory, forced-explore retry
   on low-conf BLOCKED/WAIT.
2. **Custom tools system** (`cmd/agent-webmcp/customtools.go`, `main.go`, `webmcp.go`):
   `tools add/list/remove/load/verify`; `open` auto-injects **verified** tools
   only; `invoke`/`decide` self-heal (re-inject after navigation);
   `decide` refuses with `bot_wall` on challenge pages.
3. **`lab/`**: Jev experiment harness (`mini_loop.mjs` zero-dep Jev+Mercury loop
   with `--cdp-url` for remote browsers, `jev_ping.py`, `cdp_perf.mjs`),
   `OBSERVATIONS.md` (8 findings from 7/7 real-site runs), `traces/*.jsonl`,
   custom tool sources (`custom-tools/hn.js`, `wx.js` + legacy chat tools).

## To resume on a new machine

```bash
git clone https://github.com/system1970/agent-webmcp.git && cd agent-webmcp
go build -o agent-webmcp ./cmd/agent-webmcp   # Go 1.24+
```

Recreate `.env.local` (git-ignored, **re-enter keys — none are in the repo**):
`TYPESAFE_API_KEY`, `NOUS_API_KEY`, `INCEPTION_API_KEY` (+ `BROWSERBASE_API_KEY`
as env var when needed). Lab runs: `set -a; source .env.local; set +a`.

Re-register custom tools: `agent-webmcp tools add lab/custom-tools/hn.js
--for news.ycombinator.com` (same for `wx.js` → `weather.gov,forecast.weather.gov`),
then `tools verify`. Chat tools (`mintlify/shopify/vgpu-chat.js`) are reference
sources; verify before trusting (sites drift).

## Open threads

- Port mini_loop's layout-presence visibility fallback to Go `observe.js`
  (`checkVisibility` lies about sticky/overflow-clipped containers — drops
  Mintlify chat inputs from snapshots).
- Re-resolve geometry immediately before click (remote-CDP scroll-click race).
- `ts.js` (docs.typesafe.ai chat tools) still unauthored — validated selectors
  are in chat history: `#chat-assistant-textarea`, `button.chat-assistant-send-button`
  (aria-label match; innerText empty), Send-returns = settled.
- Jev-vs-manual comparison needs a re-run with the fixed snapshot before judging.
