package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRenderLoopGoal(t *testing.T) {
	got, err := renderLoopGoal("Fill {{field}} with {{url}} then continue", map[string]any{"field": "URL", "url": "https://x.com"})
	if err != nil || got != "Fill URL with https://x.com then continue" {
		t.Errorf("render = %q, %v", got, err)
	}
	if _, err := renderLoopGoal("Fill {{missing}}", map[string]any{}); err == nil {
		t.Errorf("missing param must error, never guess")
	}
	if _, err := renderLoopGoal("No holes", map[string]any{"a": "b"}); err != nil {
		t.Errorf("hole-free template with args must pass: %v", err)
	}
}

func TestValuesEquivalent(t *testing.T) {
	cases := []struct {
		want, got string
		eq        bool
	}{
		{"https://example.com", "https://example.com", true},
		{"https://example.com", "example.com", true},
		{"https://example.com/", "example.com", true},
		{"https://Example.COM", "example.com", true},
		{"https://example.com", "https://other.com", false},
		{"https://example.com/a", "example.com/b", false},
		{"", "example.com", false},
	}
	for _, c := range cases {
		if got := valuesEquivalent(c.want, c.got); got != c.eq {
			t.Errorf("valuesEquivalent(%q,%q) = %v, want %v", c.want, c.got, got, c.eq)
		}
	}
}

func TestLoopToolSchema(t *testing.T) {
	s := loopToolSchema([]string{"url", "tagline"})
	req, _ := s["required"].([]string)
	if len(req) != 2 || req[0] != "url" {
		t.Errorf("required = %v, want all params", req)
	}
}

func TestLoopToolRegistry(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_WEBMCP_HOME", dir)
	loop := toolMeta{Name: "t-loop", Hosts: []string{"x.com"}, Kind: "loop", Goal: "Do {{x}}", Params: []string{"x"}}
	b, _ := json.Marshal(loop)
	if err := os.MkdirAll(filepath.Join(dir, "tools"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "tools", "t-loop.json"), b, 0o644)
	// Page-kind record without File must not load; loop without File must.
	page := toolMeta{Name: "t-page", Hosts: []string{"x.com"}}
	pb, _ := json.Marshal(page)
	_ = os.WriteFile(filepath.Join(dir, "tools", "t-page.json"), pb, 0o644)
	tools, err := loadCustomTools()
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 1 || tools[0].Name != "t-loop" || tools[0].Kind != "loop" {
		t.Errorf("registry = %+v, want only the loop tool", tools)
	}
	m, err := findLoopTool("t-loop")
	if err != nil || m == nil || m.Goal != "Do {{x}}" {
		t.Errorf("findLoopTool = %+v, %v", m, err)
	}
	if m2, _ := findLoopTool("t-page"); m2 != nil {
		t.Errorf("page tool must not resolve as loop tool")
	}
}
