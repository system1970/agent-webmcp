package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Authoring verbs: eval (hatch), recon (inventory), tools (spec pipeline).

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

func reconCmd(ctx context.Context, g *globals, rest []string) int {
	t, err := sessionTarget(g.session, time.Duration(g.timeoutMs)*time.Millisecond)
	if err != nil {
		return failErr("no_page", err)
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	raw, err := evalScript(ctx, t.WebSocketDebuggerURL, reconJS, timeout)
	if err != nil {
		return failErr("recon_failed", err)
	}
	var inv struct {
		URL      string `json:"url"`
		Controls []struct {
			Role string `json:"role"`
			Name string `json:"name"`
			X    int    `json:"x"`
			Y    int    `json:"y"`
			Ctx  string `json:"ctx"`
			Sel  string `json:"sel"`
		} `json:"controls"`
		Gates []string `json:"gates"`
	}
	if err := json.Unmarshal([]byte(raw), &inv); err != nil {
		return failErr("recon_failed", err)
	}
	type draftCtl struct {
		Key  string `json:"key"`
		Role string `json:"role"`
		Name string `json:"name"`
		Sel  string `json:"sel,omitempty"`
		Ctx  string `json:"ctx,omitempty"`
	}
	draft := map[string]any{"host": hostOfURL(inv.URL), "scopeCss": "", "controls": []draftCtl{}, "gates": inv.Gates}
	ctls := []draftCtl{}
	for _, c := range inv.Controls {
		ctx := ""
		if strings.Contains(strings.ToLower(c.Ctx), "code-block") {
			ctx = "!code-block"
		}
		ctls = append(ctls, draftCtl{Key: "", Role: strings.ToLower(c.Role), Name: c.Name, Sel: c.Sel, Ctx: ctx})
	}
	draft["controls"] = ctls
	natives, _, _ := listWebMCP(ctx, t.WebSocketDebuggerURL, timeout)
	names := []string{}
	for _, n := range natives {
		names = append(names, n.Name)
	}
	draft["natives"] = names
	if g.json {
		ok(draft)
		return 0
	}
	b, _ := json.MarshalIndent(draft, "", "  ")
	fmt.Println(string(b))
	return 0
}
