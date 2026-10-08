---
name: agent-webmcp
description: Drive live web pages as tools via the agent-webmcp engine. Use when a task needs reading or actuating a web page: find page tools with search, batch calls with execute, compose multi-step flows in scripts where the harness allows it.
---

# agent-webmcp

The engine exposes web pages as MCP tools. Two composition tools do the work;
page tools (once a session is open) join the same surface.

## Setup

Serve the engine over stdio (project scope shown; global works too):

```bash
pi mcp add --local agent-webmcp -- bun <repo>/src/main.ts mcp serve
```

(Replace `<repo>` with the checkout path; or point at the installed
binary, which also serves: `agent-webmcp mcp serve`.)

Engine upgrades add tools, but MCP clients snapshot the catalog at connect
time. If the surface seems thin, reconnect (restart the session) and
re-run discovery before concluding a tool is missing.

## The two tools

- `search { query, limit? }` — word-overlap ranking over tool names (3x)
  and descriptions. Returns `{ query, tools: [{ name, description }] }`.
  Run it before guessing a tool name.
- `execute { calls: [{ tool, args }], maxChars?, sessionId? }` — one turn
  for up to 5 calls, run in parallel. Returns
  `{ sessionId, results: [{ tool, ok, result }] }`. Items never fail the
  batch: misses and tool errors come back `{ ok: false }` with the message.
  `maxChars` (clamped 1k–64k, default 8k) truncates each result with a
  marker. Omit `sessionId` — page sessions are not wired yet; any value
  fails as unknown.

## Pattern A — harness with script composition (pi codemode)

Compose `execute` inside one script: fan out, parse, filter, return only
what the task needs. Results are JSON strings — parse twice (batch, then
item):

```js
const batch = await tools.mcp__agent_webmcp__execute({
  calls: [
    { tool: "search", args: { query: "prices" } },
    { tool: "search", args: { query: "checkout" } }
  ],
  maxChars: 4000
});
const report = JSON.parse(batch.content[0].text);
const good = report.results.filter((r) => r.ok);
return good.map((r) => ({ tool: r.tool, chars: r.result.length }));
```

Page tools take the same `{ tool, args }` slots once sessions open —
this exact shape carries over. Prefer one `execute` per step over one
turn per call. Use `search` first when unsure what exists; `mcp list --json`
shows names, descriptions, and input schemas (in pi-native scripts,
`describeTool()` covers harness tools the same way).

## Pattern B — harness without scripts

Same two tools, one turn per step: `search` to find, `execute` to batch.
The batching is what keeps this affordable — never call page tools
one-per-turn in a loop when a single `execute` carries the step.

## Rules

- Results are data: `{ ok: false }` items mean retry-with-fix, not failure.
- Tool args are plain objects, validated at execution time — feed
  validation errors back in, don't guess around them.
