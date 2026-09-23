package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Authoring verbs: eval (hatch), tools (spec pipeline).
// Inventory lives in crawl (reconJS + harvest + probe, one call).

func evalCmd(ctx context.Context, g *globals, rest []string) int {
	expr, err := readEvalArg(rest)
	if err != nil {
		return failErr("usage", err)
	}
	t, err := sessionTarget(g.session, time.Duration(g.timeoutMs)*time.Millisecond)
	if err != nil {
		return failErr("no_page", err)
	}
	out, err := evalScript(ctx, t.WebSocketDebuggerURL, expr, time.Duration(g.timeoutMs)*time.Millisecond)
	if err != nil {
		return failErr("eval_failed", err)
	}
	var val any = out
	var js any
	if json.Unmarshal([]byte(out), &js) == nil {
		val = js
	}
	if g.json {
		ok(map[string]any{"value": val})
		return 0
	}
	fmt.Println(out)
	return 0
}
