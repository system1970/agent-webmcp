# Codemode: opencode vs Cloudflare (read 2026-10-09)

Sources: `anomalyco/opencode packages/codemode/{README,AGENTS}.md` @ v2.0.24
(we run v2.0.24); Cloudflare `agents/tools/codemode/{index,how-it-works}`
docs (2026-06-24). Yes — opencode's is literally written with Effect
(`Tool.make` with Effect Schema in/out, `CodeMode.make`,
`Effect.runPromise`, before/after hooks).

## Same pattern

One outer tool taking code; typed connector namespaces as globals;
sync `search()` discovery with pagination; results stay in the run,
only the final value returns. Both decode schemas on the way in and
copy values across the boundary (no shared references). Both truncate
with an in-band marker instead of failing.

## Different bets

| Axis | opencode `@opencode/codemode` | Cloudflare `@cloudflare/codemode` |
|---|---|---|
| Executor | pure TS interpreter, restricted JS subset (no isolate/sandbox) | isolated Worker per pass (`DynamicWorkerExecutor`) |
| State | stateless per execution | durable runtime (SQLite facet): executions, approvals, snippets |
| Discovery extras | `catalog()`, `searchSignature`, `toolExpression(path)` | `describe()` typed docs; same search shape |
| Types | Effect Schema both directions | connector JSON Schemas / OpenAPI-derived |
| Approvals | before/after hooks (deny = throw) | abort + replay across passes, HITL queue |
| Errors | diagnostic taxonomy (ParseError, UnknownTool, ToolFailure…) | completed / paused / error + pending actions |
| Reuse | none (stateless) | snippets (saved, searchable, runnable) |
| Limits | timeoutMs / maxToolCalls / maxOutputBytes | 1M-char durable values, `transformResult` |

## What it means for agent-webmcp

Our engine is a *connector* in both vocabularies (an MCP server to
opencode; a connector candidate to Cloudflare). Consequences, all
already reflected in Units 3–5:

- Discovery parity: our search (scored paths + signatures) +
  describe (full record on demand) mirrors `searchSignature` /
  `describe`. No `catalog()` dump — snapshot-at-connect clients get
  `mcp list` instead.
- No replay/approvals/durability on our side: locally, CLI exit codes
  + `close --all` are the rollback story. Snippets ≈ SKILL.md patterns.
- Our `execute` batch stays the fallback for harnesses without
  codemode; where codemode exists, agents compose our 6→7 tools
  directly (SKILL.md "Which composition to use").
- Spill-to-disk matches both houses' truncation-marker convention,
  with our addition (structured `spill` field) addressing the forged-
  marker vector neither documents.
