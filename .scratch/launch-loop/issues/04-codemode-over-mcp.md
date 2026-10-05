# Should codemode be exposed through MCP?

Type: grilling
Status: resolved

## Answer
Superseded by the build map: this decision is made by building (map.md sections 1–6), not by debate.
Blocked by: 03

## Question

The `mcp` server dispatches in-process against the same internals as
the CLI (`mcp.go:16`), currently six core tools (`mcp.go:56`).
Decide whether `execute` becomes an MCP tool: what the program input
looks like over the protocol, how budgets and auth-pauses
(`execAuthError`, confirm-gated tools refusing inside `execute`)
surface to MCP clients, and whether page-tool results keep their
`untrusted` marking end to end.
