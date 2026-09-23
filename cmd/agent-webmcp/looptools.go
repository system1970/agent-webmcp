package main

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

// Loop-backed tools: the executor is a bounded Jev run, not page JS.
//
// Page JS cannot reach the loop (no CLI, no key, no CDP in-page), so a
// tool that needs judgment — wizards, conditional flows, dynamic
// widgets — is registered in the CLI tool registry with a goal template
// instead of a JS file. Invocation renders the goal with the caller's
// params and runs the shared runLoop; the tool returns when the run
// terminates. decide's INVOKE head stays page-tools-only: loop-in-loop
// reentrancy is deferred, not designed.

var loopPlaceholderRe = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_-]+)\s*\}\}`)

// loopToolSchema describes string params; every declared param is required.
func loopToolSchema(params []string) map[string]any {
	props := map[string]any{}
	for _, p := range params {
		props[p] = map[string]any{"type": "string", "description": p}
	}
	return map[string]any{"type": "object", "properties": props, "required": params}
}

// renderLoopGoal substitutes {{param}} from args. A missing or unknown
// placeholder is an error: the loop must never guess a value.
func renderLoopGoal(tmpl string, args map[string]any) (string, error) {
	var missing []string
	out := loopPlaceholderRe.ReplaceAllStringFunc(tmpl, func(m string) string {
		name := loopPlaceholderRe.FindStringSubmatch(m)[1]
		v, ok := args[name]
		if !ok {
			missing = append(missing, name)
			return m
		}
		if s, ok := v.(string); ok {
			return s
		}
		return fmt.Sprintf("%v", v)
	})
	if len(missing) > 0 {
		return "", fmt.Errorf("missing params: %s", strings.Join(missing, ","))
	}
	if loopPlaceholderRe.MatchString(out) {
		return "", fmt.Errorf("unknown placeholder in goal template")
	}
	return out, nil
}

func findLoopTool(name string) (*toolMeta, error) {
	tools, err := loadCustomTools()
	if err != nil {
		return nil, err
	}
	for i := range tools {
		if tools[i].Name == name && tools[i].Kind == "loop" {
			return &tools[i], nil
		}
	}
	return nil, nil
}

// loopFillText resolves the value fed to TYPE_TEXT actions: the declared
// fillParam, else the first required param. Single-fill flows only;
// multi-fill wizards need per-step tools, not guessing.
func loopFillText(meta *toolMeta, args map[string]any) string {
	fp := meta.FillParam
	if fp == "" && len(meta.Params) > 0 {
		fp = meta.Params[0]
	}
	if fp == "" {
		return ""
	}
	if s, ok := args[fp].(string); ok {
		return s
	}
	return fmt.Sprintf("%v", args[fp])
}

// runLoopToolCore validates, renders, and runs a loop tool to terminal.
func runLoopToolCore(ctx context.Context, session string, meta *toolMeta, args map[string]any, timeout time.Duration, maxSteps int) (status string, steps int, reason, goal string, code string, err error) {
	for _, p := range meta.Params {
		v, ok := args[p]
		if !ok || strings.TrimSpace(fmt.Sprintf("%v", v)) == "" {
			return "", 0, "", "", "args_needed", fmt.Errorf("tool %s missing required %q (supply --params)", meta.Name, p)
		}
	}
	goal, err = renderLoopGoal(meta.Goal, args)
	if err != nil {
		return "", 0, "", "", "bad_goal", err
	}
	steps = maxSteps
	if steps <= 0 {
		steps = meta.MaxSteps
	}
	if steps <= 0 {
		steps = 8
	}
	if steps > 30 {
		steps = 30
	}
	runID := fmt.Sprintf("loop-%d", time.Now().UnixNano())
	status, steps, reason, code, err = runLoop(ctx, session, goal, loopFillText(meta, args), timeout, steps, runID, nil)
	return status, steps, reason, goal, code, err
}

func failPlain(g *globals, code, msg string) int {
	if g.json {
		fmt.Printf("%s\n", mustJSON(map[string]any{"ok": false, "code": code, "error": msg}))
		return 1
	}
	fmt.Fprintf(os.Stderr, "error [%s]: %s\n", code, msg)
	return 1
}

// execLoopTool runs a loop tool end to end with invoke-shaped receipts.
func execLoopTool(ctx context.Context, g *globals, meta *toolMeta, paramsJSON string, maxSteps int) int {
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	args, err := parseParams(paramsJSON)
	if err != nil {
		return failPlain(g, "bad_params", err.Error())
	}
	if args == nil {
		args = map[string]any{}
	}
	status, steps, reason, goal, code, err := runLoopToolCore(ctx, g.session, meta, args, timeout, maxSteps)
	if err != nil {
		if code == "auth_required" {
			return finishAuthRequired(g, goal, steps, currentPageURL(g.session))
		}
		if code == "" {
			code = "loop_failed"
		}
		return failPlain(g, code, err.Error())
	}
	data := map[string]any{"tool": meta.Name, "status": status, "steps": steps, "reason": reason, "goal": goal}
	if status == "DONE" {
		if g.json {
			ok(data)
			return 0
		}
		fmt.Printf("%s %s after %d steps (%s) — verify independently\n", meta.Name, status, steps, reason)
		return 0
	}
	if g.json {
		fmt.Printf("%s\n", mustJSON(map[string]any{"ok": false, "code": "blocked", "error": reason, "data": data}))
		return 1
	}
	fmt.Fprintf(os.Stderr, "%s %s after %d steps (%s) — verify independently\n", meta.Name, status, steps, reason)
	return 1
}

func hasFlag(args []string, name string) bool {
	for _, a := range args {
		if a == "--"+name {
			return true
		}
	}
	return false
}
