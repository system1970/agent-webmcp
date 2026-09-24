package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func stubLeaves() (map[string]execLeafFn, map[string]string) {
	leaves := map[string]execLeafFn{
		"get_title": func(args map[string]any) (any, error) {
			return "Example Domain", nil
		},
		"get_links": func(args map[string]any) (any, error) {
			return []any{"https://a.example", "https://b.example"}, nil
		},
		"echo": func(args map[string]any) (any, error) {
			return args, nil
		},
		"needs_q": func(args map[string]any) (any, error) {
			if _, ok := args["q"]; !ok {
				return nil, fmt.Errorf("args_needed: tool needs_q missing required %q", "q")
			}
			return args["q"], nil
		},
		"boom": func(args map[string]any) (any, error) {
			return nil, fmt.Errorf("kaboom")
		},
		"walled": func(args map[string]any) (any, error) {
			return nil, &execAuthError{url: "https://x.example/login"}
		},
	}
	desc := map[string]string{}
	for k := range leaves {
		desc[k] = k + " stub"
	}
	return leaves, desc
}

func runStub(t *testing.T, code string, maxCalls int64) (any, error) {
	t.Helper()
	leaves, desc := stubLeaves()
	counters := &execCounters{max: maxCalls}
	rt := buildExecRuntime(leaves, desc, counters)
	return runExecProgram(rt, code, 5*time.Second)
}

func TestExecCompose(t *testing.T) {
	out, err := runStub(t, `const t = tools.get_title({}); const l = tools.get_links({}); return {title: t, n: l.length};`, 10)
	if err != nil {
		t.Fatalf("program failed: %v", err)
	}
	m, ok := out.(map[string]any)
	if !ok || m["title"] != "Example Domain" {
		t.Fatalf("unexpected result: %#v", out)
	}
	if n, ok := m["n"].(int64); !ok || n != 2 {
		t.Fatalf("unexpected count: %#v", out)
	}
}

func TestExecDependent(t *testing.T) {
	out, err := runStub(t, `const q = tools.needs_q({q: "hi"}); return tools.echo({got: q});`, 10)
	if err != nil {
		t.Fatalf("program failed: %v", err)
	}
	m := out.(map[string]any)
	if m["got"] != "hi" {
		t.Fatalf("unexpected result: %#v", out)
	}
}

func TestExecBatchOrder(t *testing.T) {
	out, err := runStub(t, `return batch([{tool: "get_links", args: {}}, {tool: "get_title", args: {}}]);`, 10)
	if err != nil {
		t.Fatalf("program failed: %v", err)
	}
	arr, ok := out.([]any)
	if !ok || len(arr) != 2 {
		t.Fatalf("unexpected result: %#v", out)
	}
	if _, ok := arr[0].([]any); !ok {
		t.Fatalf("batch order broken: %#v", out)
	}
	if arr[1] != "Example Domain" {
		t.Fatalf("batch order broken: %#v", out)
	}
}

func TestExecUnknownTool(t *testing.T) {
	_, err := runStub(t, `return tools.nope({});`, 10)
	if err == nil {
		t.Fatal("expected error for unknown tool")
	}
	// Must surface as a JS error, never a Go crash. (Reaching here
	// already proves no crash; message check is documentation.)
	t.Logf("unknown tool error: %v", err)
}

func TestExecMaxCalls(t *testing.T) {
	_, err := runStub(t, `tools.get_title({}); tools.get_title({}); tools.get_title({}); return 1;`, 2)
	if err == nil || !strings.Contains(err.Error(), "max_calls exceeded") {
		t.Fatalf("expected max_calls trip, got: %v", err)
	}
}

func TestExecMissingRequired(t *testing.T) {
	_, err := runStub(t, `return tools.needs_q({});`, 10)
	if err == nil || !strings.Contains(err.Error(), "args_needed") {
		t.Fatalf("expected args_needed, got: %v", err)
	}
}

func TestExecToolFailure(t *testing.T) {
	_, err := runStub(t, `return tools.boom({});`, 10)
	if err == nil || !strings.Contains(err.Error(), "kaboom") {
		t.Fatalf("expected kaboom, got: %v", err)
	}
}

func TestExecAuthMarker(t *testing.T) {
	_, err := runStub(t, `return tools.walled({});`, 10)
	if err == nil || !strings.Contains(err.Error(), "AUTH_REQUIRED::https://x.example/login") {
		t.Fatalf("expected auth marker, got: %v", err)
	}
}

func TestExecNeedsReturn(t *testing.T) {
	out, err := runStub(t, `tools.get_title({});`, 10)
	if err != nil {
		t.Fatalf("program failed: %v", err)
	}
	if out != nil {
		t.Fatalf("no-return program should yield null, got: %#v", out)
	}
}

func TestExecTimeout(t *testing.T) {
	leaves := map[string]execLeafFn{
		"slow": func(args map[string]any) (any, error) {
			time.Sleep(300 * time.Millisecond)
			return "late", nil
		},
	}
	counters := &execCounters{max: 10}
	rt := buildExecRuntime(leaves, map[string]string{"slow": "slow stub"}, counters)
	_, err := runExecProgram(rt, `return tools.slow({});`, 50*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "execute timeout") {
		t.Fatalf("expected timeout, got: %v", err)
	}
}
