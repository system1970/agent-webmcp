# Sessions (wired)

Page tools are stateful — they run against an open page — but CLI
invocations and MCP calls are stateless. Sessions bridge the two with an
opaque handle (`s_...`, crypto-random) persisted on disk:

- `open` attaches to a page (launching a detached browser, or borrowing a
  foreign tab via `--cdp`) and records `{handle, browserHttp, targetId,
  url, ownBrowser, pid, port}` under `/tmp/opencode/agent-webmcp-sessions/`.
- `list`, `invoke`, `execute` (with `sessionId`) dial the recorded
  browser, reattach the recorded target, work, and hang up. Nothing live
  persists between calls except the record — and `/tmp` dies on reboot,
  as do the browsers, so records never outlive the machine.
- `close` releases the page and kills browsers we launched (pid verified
  via `/proc` exe + profile marker before SIGKILL). Foreign browsers are
  never touched beyond the borrowed tab.

Liveness: a recorded target can die (tab closed, browser restarted).
Reattach maps that to `navigated`: close the dead handle, open again.

Catalog freshness: the page's tool set moves (per-state registration).
`list`/`invoke`/`execute` seed from the page surface and fold in a live
window; events win. Held-subscription sessions (daemon `serve` modes)
are the future refinement, not a Unit 2-3 gap: per-call reattach is
correct, just not streaming.

Future: expiry/idle-close, per-session caps.
