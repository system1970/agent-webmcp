package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMcpToolSet(t *testing.T) {
	tools := mcpCoreTools()
	if len(tools) == 0 {
		t.Fatal("no MCP tools")
	}
	seen := map[string]bool{}
	for _, tl := range tools {
		if tl.Name == "" || tl.Description == "" || tl.Schema == nil {
			t.Fatalf("incomplete tool def: %+v", tl.Name)
		}
		if !strings.HasPrefix(tl.Name, "agent_webmcp_") {
			t.Fatalf("tool %q misses namespace prefix", tl.Name)
		}
		if seen[tl.Name] {
			t.Fatalf("duplicate tool %q", tl.Name)
		}
		seen[tl.Name] = true
	}
	for _, want := range []string{"agent_webmcp_open", "agent_webmcp_list_tools", "agent_webmcp_invoke_tool", "agent_webmcp_observe", "agent_webmcp_close", "agent_webmcp_tools_profiles"} {
		if !seen[want] {
			t.Fatalf("core tool missing: %s", want)
		}
	}
}

func TestMcpProtocolNegotiation(t *testing.T) {
	for _, v := range []string{"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"} {
		if !mcpSupportedVersions[v] {
			t.Fatalf("should support %s", v)
		}
	}
	if mcpSupportedVersions["1999-01-01"] {
		t.Fatal("supports a version it should not")
	}
}

func TestMcpCodeFor(t *testing.T) {
	if got := codeFor(errTestSentinel()); got != "mcp_failed" {
		t.Fatalf("unknown error code = %q", got)
	}
}

func errTestSentinel() error { return errTestVal }

var errTestVal = testErr("boom")

type testErr string

func (e testErr) Error() string { return string(e) }

func TestMcpEnvelopeShapes(t *testing.T) {
	// tools/list item shape serializes with the three required fields.
	tools := mcpCoreTools()
	b, _ := json.Marshal(map[string]any{"name": tools[0].Name, "description": tools[0].Description, "inputSchema": tools[0].Schema})
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("envelope: %v", err)
	}
	for _, k := range []string{"name", "description", "inputSchema"} {
		if _, ok := m[k]; !ok {
			t.Fatalf("envelope missing %q", k)
		}
	}
}
