package main

import (
	"testing"
)

func TestParseGlobalsDefaults(t *testing.T) {
	g, rest := parseGlobals([]string{})
	if g.session != "default" {
		t.Fatalf("session = %q, want default", g.session)
	}
	if g.timeoutMs != 30000 {
		t.Fatalf("timeoutMs = %d, want 30000", g.timeoutMs)
	}
	if len(rest) != 0 {
		t.Fatalf("rest = %v, want empty", rest)
	}
}

func TestParseGlobalsSessionAndJSON(t *testing.T) {
	g, rest := parseGlobals([]string{"--session", "work", "--json", "open"})
	if g.session != "work" {
		t.Fatalf("session = %q, want work", g.session)
	}
	if !g.json {
		t.Fatal("json = false, want true")
	}
	if len(rest) != 1 || rest[0] != "open" {
		t.Fatalf("rest = %v, want [open]", rest)
	}
}

func TestParseGlobalsEqualsForm(t *testing.T) {
	g, _ := parseGlobals([]string{"--session=task1", "--timeout-ms=5000"})
	if g.session != "task1" {
		t.Fatalf("session = %q, want task1", g.session)
	}
	if g.timeoutMs != 5000 {
		t.Fatalf("timeoutMs = %d, want 5000", g.timeoutMs)
	}
}

func TestFirstLine(t *testing.T) {
	if got := firstLine("one\ntwo"); got != "one" {
		t.Fatalf("firstLine newline = %q, want one", got)
	}
	if got := firstLine("  spaced  "); got != "spaced" {
		t.Fatalf("firstLine trim = %q, want spaced", got)
	}
}

func TestPackName(t *testing.T) {
	cases := map[string]string{
		"My Pack!":  "my-pack",
		"  a/b\\c ": "a-b-c",
		"":         "pack",
		"---":      "pack",
		"mintlify": "mintlify",
	}
	for in, want := range cases {
		if got := packName(in); got != want {
			t.Fatalf("packName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeHost(t *testing.T) {
	cases := map[string]string{
		"https://Example.com/docs": "example.com",
		"www.mintlify.com/":        "www.mintlify.com",
		"":                         "*",
	}
	for in, want := range cases {
		if got := normalizeHost(in); got != want {
			t.Fatalf("normalizeHost(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHostOfURL(t *testing.T) {
	if got := hostOfURL("https://www.Eve.dev/docs?a=1"); got != "eve.dev" {
		t.Fatalf("hostOfURL = %q, want eve.dev", got)
	}
}


func TestParseInt(t *testing.T) {
	n, err := parseInt("42")
	if err != nil || n != 42 {
		t.Fatalf("parseInt(42) = %d, %v", n, err)
	}
	if _, err := parseInt("abc"); err == nil {
		t.Fatal("parseInt(abc) should fail, not silently keep old value")
	}
	if _, err := parsePositiveInt("0"); err == nil {
		t.Fatal("parsePositiveInt(0) should fail")
	}
}

func TestStrFieldSafe(t *testing.T) {
	m := map[string]any{"name": "x"}
	if strField(m, "name") != "x" {
		t.Fatal("strField should return value")
	}
	if strField(m, "missing") != "" {
		t.Fatal("missing key should yield empty, not panic")
	}
	if strField(nil, "name") != "" {
		t.Fatal("nil map should yield empty, not panic")
	}
	bad := map[string]any{"name": 123}
	if strField(bad, "name") != "" {
		t.Fatal("mistyped field should yield empty, not panic")
	}
}

func TestWebMCPStatusShape(t *testing.T) {
	s := WebMCPStatus{Experimental: true, Available: true, ToolCount: 2}
	if !s.Available || s.ToolCount != 2 {
		t.Fatalf("unexpected status %+v", s)
	}
}

func TestParseGlobalsDesc(t *testing.T) {
	g, _ := parseGlobals([]string{"--session", "exa", "--desc", "exa docs panel"})
	if g.session != "exa" || g.desc != "exa docs panel" {
		t.Fatalf("desc parse = %+v", g)
	}
	g2, _ := parseGlobals([]string{"--description=docs job"})
	if g2.desc != "docs job" {
		t.Fatalf("description= parse = %+v", g2)
	}
}

func TestSessionMetaDescRoundtrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_WEBMCP_HOME", dir)
	writeDesc("exa", "exa docs ask-panel")
	m := readMeta("exa")
	if m.Desc != "exa docs ask-panel" {
		t.Fatalf("desc = %q", m.Desc)
	}
	if m.Created == "" || m.LastUsed == "" {
		t.Fatal("created/lastUsed should be set")
	}
	touchSession("exa", "https://exa.ai/docs")
	m2 := readMeta("exa")
	if m2.LastURL != "https://exa.ai/docs" || m2.Desc != "exa docs ask-panel" {
		t.Fatalf("touch kept label + url: %+v", m2)
	}
	if idleFor("") != "" || idleFor("not-a-time") != "" {
		t.Fatal("bad time should yield empty idle")
	}
}

func TestFrameCacheRoundtrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_WEBMCP_HOME", dir)
	if _, ok := frameCacheGet("s1", "tool_a"); ok {
		t.Fatal("empty cache should miss")
	}
	frameCacheSet("s1", "tool_a", "frame1")
	if f, ok := frameCacheGet("s1", "tool_a"); !ok || f != "frame1" {
		t.Fatalf("cache get = %q,%v want frame1,true", f, ok)
	}
	frameCacheSet("s1", "tool_b", "frame2")
	frameCacheSaveAll("s1", []WebMCPTool{{Name: "tool_c", FrameID: "frame3"}})
	if f, ok := frameCacheGet("s1", "tool_c"); !ok || f != "frame3" {
		t.Fatalf("saveAll get = %q,%v want frame3,true", f, ok)
	}
	// existing entries survive saveAll
	if f, ok := frameCacheGet("s1", "tool_a"); !ok || f != "frame1" {
		t.Fatalf("saveAll kept a: %q,%v", f, ok)
	}
	frameCacheInvalidate("s1", "tool_a")
	if _, ok := frameCacheGet("s1", "tool_a"); ok {
		t.Fatal("invalidated entry should miss")
	}
	// empty session/tool never stored
	frameCacheSet("", "x", "f")
	frameCacheSet("s1", "", "f")
	if _, ok := frameCacheGet("", "x"); ok {
		t.Fatal("empty session should miss")
	}
}

func TestScanCacheFramePath(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_WEBMCP_HOME", dir)
	scanCacheSave("s1", "https://x.test", []map[string]any{
		{"role": "button", "name": "Copy", "fp": ""},
		{"role": "button", "name": "Iframe action", "fp": "0"},
	})
	if r, n, f, cb, ok := scanCacheLookup("s1", 1); !ok || r != "button" || n != "Copy" || f != "" || cb != 0 {
		t.Fatalf("ref1 = %q,%q,%q,%d,%v", r, n, f, cb, ok)
	}
	if r, n, f, cb, ok := scanCacheLookup("s1", 2); !ok || r != "button" || n != "Iframe action" || f != "0" || cb != 0 {
		t.Fatalf("ref2 = %q,%q,%q,%d,%v", r, n, f, cb, ok)
	}
	if _, _, _, _, ok := scanCacheLookup("s1", 3); ok {
		t.Fatal("ref3 should miss")
	}
}

func TestScanCacheClosedBid(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_WEBMCP_HOME", dir)
	scanCacheSave("s1", "https://x.test", []map[string]any{
		{"role": "button", "name": "Closed action", "cbid": float64(24)},
	})
	if r, n, f, cb, ok := scanCacheLookup("s1", 1); !ok || r != "button" || n != "Closed action" || f != "" || cb != 24 {
		t.Fatalf("closed ref = %q,%q,%q,%d,%v", r, n, f, cb, ok)
	}
}
