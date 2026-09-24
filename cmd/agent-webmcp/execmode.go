package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dop251/goja"
)

// execmode: codemode for the CLI. One spawn, N tool calls: an agent ships
// a JS program, goja runs it against the session's tool registry, one
// envelope comes back. Composition lives here, not in N round trips.
//
// Sandbox rules (mirror opencode's authority model):
// - tools.* are the ONLY externals: page + loop tools of this session.
//   No fetch, no fs, no timers, no imports. Programs exercise authority
//   already present in the tools; they gain none through code.
// - Calls are synchronous. Fan-out goes through batch() (concurrent in
//   Go, ordered results, cap 8). No event loop, no promises.
// - Top-level explicit return is required (IIFE wrap gives scope
//   isolation; bare completion values don't survive the wrap).
// - Confirm-gated loop tools refuse inside execute: a program cannot
//   pause mid-run for a human. auth_required propagates as a typed
//   pause with remedy, like every other verb.

const execBatchCap = 8

// execAuthError aborts the program as a typed pause, not a failure.
type execAuthError struct{ url string }

func (e *execAuthError) Error() string { return "AUTH_REQUIRED::" + e.url }

// execLeafFn executes one tool. args arrive as plain data; the return
// value must be JSON-marshalable (or nil).
type execLeafFn func(args map[string]any) (any, error)

// execCatalog is the session's callable set, built once per execute.
type execCatalog struct {
	leaves map[string]execLeafFn
	desc   map[string]string
	names  []string
}

func (c *execCatalog) supplyHint() string {
	return "available tools: " + strings.Join(c.names, ", ") + " (run: list --query)"
}

// execCounters tracks budgets across leaves and batches.
type execCounters struct {
	calls int64
	max   int64
}

func (c *execCounters) claim() error {
	if atomic.AddInt64(&c.calls, 1) > c.max {
		return fmt.Errorf("max_calls exceeded (%d)", c.max)
	}
	return nil
}

// throw converts a leaf failure into a JS exception. Panicking with a
// goja Value surfaces as a catchable JS error from RunString, never a
// Go crash; markers let executeCmd retype pauses after the run.
func execThrow(rt *goja.Runtime, err error) {
	if auth, ok := err.(*execAuthError); ok {
		panic(rt.ToValue(auth.Error()))
	}
	panic(rt.ToValue("tool_error: " + err.Error()))
}

// buildExecRuntime wires leaves + batch() into a fresh goja Runtime.
// Fresh per execution: no state leaks between programs.
func buildExecRuntime(leaves map[string]execLeafFn, desc map[string]string, counters *execCounters) *goja.Runtime {
	rt := goja.New()
	names := make([]string, 0, len(leaves))
	toolsObj := rt.NewObject()
	for name, fn := range leaves {
		names = append(names, name)
		fn := fn
		_ = toolsObj.Set(name, func(call goja.FunctionCall) goja.Value {
			if err := counters.claim(); err != nil {
				execThrow(rt, err)
			}
			args := map[string]any{}
			if len(call.Arguments) > 0 && !goja.IsUndefined(call.Arguments[0]) && !goja.IsNull(call.Arguments[0]) {
				exported := call.Arguments[0].Export()
				if m, ok := exported.(map[string]any); ok {
					args = m
				} else {
					execThrow(rt, fmt.Errorf("tool takes one object argument"))
				}
			}
			out, err := fn(args)
			if err != nil {
				execThrow(rt, err)
			}
			return rt.ToValue(out)
		})
	}
	hint := "available tools: " + strings.Join(names, ", ") + " (run: list --query)"
	_ = toolsObj.Set("__hint", hint)
	_ = rt.Set("tools", toolsObj)
	// batch([{tool, args}]) — concurrent in Go, ordered results.
	_ = rt.Set("batch", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) == 0 || goja.IsUndefined(call.Arguments[0]) {
			panic(rt.ToValue("tool_error: batch takes an array of {tool, args}"))
		}
		items, ok := call.Arguments[0].Export().([]any)
		if !ok {
			panic(rt.ToValue("tool_error: batch takes an array of {tool, args}"))
		}
		if len(items) > execBatchCap {
			panic(rt.ToValue(fmt.Sprintf("tool_error: batch capped at %d items", execBatchCap)))
		}
		for range items {
			if err := counters.claim(); err != nil {
				execThrow(rt, err)
			}
		}
		results := make([]any, len(items))
		errs := make([]error, len(items))
		var wg sync.WaitGroup
		sem := make(chan struct{}, execBatchCap)
		for i, item := range items {
			i, item := i, item
			wg.Add(1)
			go func() {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				m, ok := item.(map[string]any)
				if !ok {
					errs[i] = fmt.Errorf("batch item %d is not {tool, args}", i)
					return
				}
				name, _ := m["tool"].(string)
				fn, ok := leaves[name]
				if !ok {
					errs[i] = fmt.Errorf("unknown tool %q in batch (%s)", name, hint)
					return
				}
				args := map[string]any{}
				if a, ok := m["args"].(map[string]any); ok {
					args = a
				}
				out, err := fn(args)
				if err != nil {
					errs[i] = err
					return
				}
				results[i] = out
			}()
		}
		wg.Wait()
		for _, err := range errs {
			if err != nil {
				execThrow(rt, err)
			}
		}
		return rt.ToValue(results)
	})
	return rt
}

// runExecProgram executes code with explicit top-level return required.
func runExecProgram(rt *goja.Runtime, code string, timeout time.Duration) (any, error) {
	if timeout > 0 {
		timer := time.AfterFunc(timeout, func() { rt.Interrupt("execute timeout") })
		defer timer.Stop()
		defer rt.ClearInterrupt()
	}
	wrapped := "(function(){\n" + code + "\n})()"
	v, err := rt.RunString(wrapped)
	if err != nil {
		return nil, err
	}
	if v == nil || goja.IsUndefined(v) {
		return nil, nil
	}
	return v.Export(), nil
}

// sessionExecCatalog builds the callable set for a session: live page
// tools (native + injected custom) plus host-matched loop tools.
func sessionExecCatalog(ctx context.Context, session string, timeout time.Duration) (*execCatalog, string, error) {
	t, err := sessionTarget(session, timeout)
	if err != nil {
		return nil, "", err
	}
	tools, _, err := listWebMCP(ctx, t.WebSocketDebuggerURL, timeout)
	if err != nil {
		if isNotFound(err) {
			return nil, "", fmt.Errorf("webmcp_unsupported: browser has no WebMCP CDP domain (use Chrome 149+)")
		}
		return nil, "", err
	}
	tools = ensureCustomTools(ctx, session, t.WebSocketDebuggerURL, t.URL, timeout, tools)
	cat := &execCatalog{leaves: map[string]execLeafFn{}, desc: map[string]string{}}
	for _, tl := range tools {
		tl := tl
		required := webmcpRequired(tl.InputSchema)
		cat.desc[tl.Name] = tl.Description
		cat.names = append(cat.names, tl.Name)
		cat.leaves[tl.Name] = func(args map[string]any) (any, error) {
			for _, r := range required {
				if _, ok := args[r]; !ok {
					return nil, fmt.Errorf("args_needed: tool %s missing required %q", tl.Name, r)
				}
			}
			fresh, _, lerr := listWebMCP(ctx, t.WebSocketDebuggerURL, timeout)
			if lerr == nil {
				ensureCustomTools(ctx, session, t.WebSocketDebuggerURL, t.URL, timeout, fresh)
			}
			pb, _ := json.Marshal(args)
			raw, err := invokeWebMCP(ctx, t.WebSocketDebuggerURL, tl.Name, string(pb), "", timeout)
			if err != nil {
				return nil, err
			}
			var val any = string(raw)
			var js any
			if json.Unmarshal(raw, &js) == nil {
				val = js
			}
			return val, nil
		}
	}
	if all, lerr := loadCustomTools(); lerr == nil {
		for _, m := range customToolsForHost(hostOfURL(t.URL), all) {
			if m.Kind != "loop" {
				continue
			}
			m := m
			desc := m.Desc
			if desc == "" {
				desc = "loop tool (bounded Jev run)"
			}
			cat.desc[m.Name] = desc
			cat.names = append(cat.names, m.Name)
			cat.leaves[m.Name] = func(args map[string]any) (any, error) {
				if m.Confirm {
					return nil, fmt.Errorf("CONFIRM_REQUIRED::tool %s needs human confirmation (invoke it directly, not inside execute)", m.Name)
				}
				maxSteps := m.MaxSteps
				if maxSteps <= 0 {
					maxSteps = 8
				}
				status, steps, reason, _, code, err := runLoopToolCore(ctx, session, &m, args, timeout, maxSteps)
				if err != nil {
					if code == "auth_required" {
						return nil, &execAuthError{url: currentPageURL(session)}
					}
					if code == "" {
						code = "loop_failed"
					}
					return nil, fmt.Errorf("%s: %s", code, err.Error())
				}
				return map[string]any{"status": status, "steps": steps, "reason": reason}, nil
			}
		}
	}
	return cat, t.URL, nil
}

func webmcpRequired(schema map[string]any) []string {
	if schema == nil {
		return nil
	}
	req, ok := schema["required"].([]any)
	if !ok {
		return nil
	}
	var out []string
	for _, r := range req {
		if name, ok := r.(string); ok {
			out = append(out, name)
		}
	}
	return out
}

func flagMaxCalls(rest []string) int64 {
	if v, ok := verbFlag(rest, "max-calls"); ok {
		if n, err := parseInt(v); err == nil && n > 0 && n <= 50 {
			return int64(n)
		}
	}
	return 10
}

func executeCmd(ctx context.Context, g *globals, rest []string) int {
	prog := ""
	if v, ok := verbFlag(rest, "program"); ok && strings.TrimSpace(v) != "" {
		if strings.HasPrefix(strings.TrimSpace(v), "@") && !strings.Contains(v, " ") {
			b, err := os.ReadFile(strings.TrimPrefix(strings.TrimSpace(v), "@"))
			if err != nil {
				return failErr("bad_program", err)
			}
			prog = string(b)
		} else {
			prog = v
		}
	} else {
		var err error
		prog, err = readEvalArg(rest)
		if err != nil {
			return fail("usage", "usage: agent-webmcp execute --program @file|<js> [--session NAME] [--max-calls N] [--json]")
		}
	}
	if strings.TrimSpace(prog) == "" {
		return fail("usage", "usage: agent-webmcp execute --program @file|<js> [--session NAME] [--max-calls N] [--json]")
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	cat, _, err := sessionExecCatalog(ctx, g.session, timeout)
	if err != nil {
		return failErr("no_page", err)
	}
	if len(cat.leaves) == 0 {
		return fail("no_tools", "session exposes no tools (run: list)")
	}
	counters := &execCounters{max: flagMaxCalls(rest)}
	rt := buildExecRuntime(cat.leaves, cat.desc, counters)
	out, err := runExecProgram(rt, prog, timeout)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "execute timeout") {
			return fail("timeout", fmt.Sprintf("program exceeded %s", timeout))
		}
		if strings.HasPrefix(msg, "AUTH_REQUIRED::") {
			return finishAuthRequired(g, "(execute program)", int(counters.calls), currentPageURL(g.session))
		}
		if strings.Contains(msg, "CONFIRM_REQUIRED::") {
			return fail("confirm_required", strings.TrimPrefix(msg, "CONFIRM_REQUIRED::"))
		}
		if strings.Contains(msg, "is not a function") || strings.Contains(msg, "is not defined") || strings.Contains(msg, "has no member") {
			return fail("program_error", msg+" ["+cat.supplyHint()+"]")
		}
		if strings.Contains(msg, "max_calls exceeded") {
			return fail("max_calls", msg)
		}
		return fail("program_error", msg)
	}
	if g.json {
		ok(map[string]any{"result": out, "tool_calls": counters.calls})
		return 0
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	fmt.Println(string(b))
	return 0
}
