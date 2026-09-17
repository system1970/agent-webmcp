# cmd/agent-webmcp — Go CLI conventions

Single package `main`. Stdlib + `github.com/coder/websocket` only. No framework, no daemon.

## Commands

Dispatch in `main.go:run` (one `case` per verb). Flags via `parseGlobals` (`--session/-s`, `--json`, `--chrome`, `--timeout-ms`, `--params`, `--frame`). Keep new verbs fixed-shape, tiny output (<1KB: roles, names, booleans, counts).

## Files

- `main.go` — dispatch + `usage()` (usage text is the docs source of truth)
- `cdp.go`, `browser.go`, `chrome.go`, `session.go` — CDP client, launch, lifecycle
- `webmcp.go` — discovery (`listTools` fast path + `toolsAdded` settle) + invoke (`invokeTool`/`toolResponded`, frame cache)
- `pagejs.go` — shared page-JS payloads (element labeling, actuation tails, read)
- `shadow.go` — closed-shadow discovery (`DOM.getDocument` pierce) + `callFunctionOn`
- `tools.go` — custom packs (`~/.agent-webmcp/tools/<name>.js+.json`), overlay provenance, `evalScript`
- `session.go` — session dirs, port/pid files, observation cache persistence
- `mcp.go`, `output.go`, `errors.go` — MCP bridge (4 tools), `{ok,data|error,code}` envelope + `ErrorCode` codes, `parseInt`/`strField` safe helpers

## Rules

- `evalScript` (`tools.go:evalScript`) is inspection-only. Actuation belongs to page tools.
- Every effect needs a verify path (read-type `invoke` or `eval`), not just a return code.
- `go vet ./...` + `go test ./...` clean before `build.cmd`. Binary stays ~7MB (`-trimpath -ldflags="-s -w"`).
