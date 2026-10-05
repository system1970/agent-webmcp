# Codemode

One JS program, N tool calls, one envelope. Composition lives here,
not in N round trips.

## Environment

- `tools.*` — the ONLY externals: live page tools + verified customs.
  One object arg per call. No fetch, no fs, no timers, no imports.
- `webmcp.search("terms"[, limit][, offset])` → JSON string of
  `{results, total}`. `webmcp.describe("name")` → one definition.
  Pull definitions; never assume the catalog.
- `batch([{tool, args}])` — sequential fan-out, ordered, cap 8.
- Explicit top-level `return` required. Undefined is refused.
- Budgets: `--max-calls` (default 10, clamp 1..50), wall timeout.
  Every leaf call claims budget and checks the deadline.
- Confirm-gated tools refuse inside `execute`: a program cannot pause
  for a human. Errors prefixed `tool_error:` are catchable in-program;
  anything else aborts the run.

## Shape

```js
const found = JSON.parse(webmcp.search("catalog shoes"));
const d = JSON.parse(webmcp.describe(found.results[0].tool));
const out = batch([{tool: found.results[0].tool, args: {query: "red"}}]);
return {results: out};
```

Cross-site: search per site lives in its own session catalog — one
`execute` per session, composed by the harness, not the program.
External plugin verbs (`plugin new`) run in this same sandbox with an
added `args` global (`{all, positional, flags}`).
