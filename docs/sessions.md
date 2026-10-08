# Sessions (designed, unwired)

Page tools are stateful — they run against an open page — but MCP calls are
stateless. Sessions bridge the two with an opaque handle:

- `open` (unwired) attaches to a page and returns a `sessionId`.
- `list`, `invoke`, `execute` take an optional `sessionId` routing the call
  to that page. Omitted means engine-local tools only.
- `close` (unwired) releases the page.

Status today: no `open` exists, so no sessions exist. Any provided
`sessionId` fails as unknown (`execute.ts`). Engine-local tools (`web_fetch`,
`search`, `execute` itself) run with `sessionId` omitted or null.

Future: expiry/idle-close, per-session caps, and surfacing the page's own
`toolchange` events as list refreshes.
