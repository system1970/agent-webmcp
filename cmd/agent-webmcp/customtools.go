package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Custom WebMCP tools.
//
// A custom tool file is page JS that registers tools via the page's own
// document.modelContext, exactly like a site-native assistant would.
// Custom tools are how traces become tools: record an interaction once,
// distill the robust selectors and wait-for-settle logic into a tool file,
// and every future session on that host gets ask/open/read/close verbs.
//
// Storage: toolsRoot() holds <name>.js + <name>.json
// ({name, hosts[], file, added, verified...}). `open` auto-injects
// verified tools whose hosts match the page; injected tool names are
// recorded per session so `list` can tag custom-tool provenance.

type toolMeta struct {
	Name       string   `json:"name"`
	Hosts      []string `json:"hosts"`
	File       string   `json:"file"`
	Added      string   `json:"added"`
	Verified   bool     `json:"verified,omitempty"`
	VerifiedAt string   `json:"verifiedAt,omitempty"`
	TestURL    string   `json:"testUrl,omitempty"`
}

func toolsRoot() string {
	if v := os.Getenv("AGENT_WEBMCP_HOME"); v != "" {
		return filepath.Join(v, "tools")
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return filepath.Join(h, ".agent-webmcp", "tools")
	}
	return ".agent-webmcp-tools"
}

func sanitizeToolName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			b.WriteRune(r)
		} else if r == ' ' || r == '.' {
			b.WriteByte('-')
		}
	}
	if b.Len() == 0 {
		return "custom tool"
	}
	return b.String()
}

func loadCustomTools() ([]toolMeta, error) {
	ents, err := os.ReadDir(toolsRoot())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []toolMeta
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(toolsRoot(), e.Name()))
		if err != nil {
			continue
		}
		var m toolMeta
		if json.Unmarshal(b, &m) != nil || m.Name == "" || m.File == "" {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}

func customToolsForHost(host string, tools []toolMeta) []toolMeta {
	host = normalizeHost(host)
	var out []toolMeta
	for _, p := range tools {
		for _, h := range p.Hosts {
			h = normalizeHost(h)
			if h == "*" || h == host || strings.HasSuffix(host, "."+h) {
				out = append(out, p)
				break
			}
		}
	}
	return out
}

// verifiedToolsForHost is the auto-inject set: host match AND a fresh
// verification stamp. Unverified tools load only via explicit `tools load`.
func verifiedToolsForHost(host string, tools []toolMeta) []toolMeta {
	var out []toolMeta
	for _, p := range tools {
		if p.Verified {
			out = append(out, p)
		}
	}
	return customToolsForHost(host, out)
}

func customToolsPath(session string) string {
	return filepath.Join(sessionDir(session), "tools.json")
}

// recordCustomTools remembers which custom tool names a session injected,
// so `list` can tag provenance without trusting page output.
func recordCustomTools(session string, names []string) {
	if len(names) == 0 {
		return
	}
	seen := customToolNames(session)
	for _, n := range names {
		seen[n] = true
	}
	merged := make([]string, 0, len(seen))
	for n := range seen {
		merged = append(merged, n)
	}
	_ = os.MkdirAll(sessionDir(session), 0o755)
	b, _ := json.Marshal(merged)
	_ = os.WriteFile(customToolsPath(session), b, 0o644)
}

func customToolNames(session string) map[string]bool {
	out := map[string]bool{}
	read := func(path string) {
		b, err := os.ReadFile(path)
		if err != nil {
			return
		}
		var names []string
		if json.Unmarshal(b, &names) == nil {
			for _, n := range names {
				out[n] = true
			}
		}
	}
	read(customToolsPath(session))
	return out
}

// injectCustomTools evaluates matching custom tool files in the page. Each
// file reports one `ok:<tool>` line per registered tool; those names are
// recorded for provenance tagging. A file that fails (no WebMCP API, old
// Chrome) reports its error and never blocks the session.
func injectCustomTools(ctx context.Context, session, wsURL string, tools []toolMeta, timeout time.Duration) (injected []string, reports []string) {
	for _, p := range tools {
		b, err := os.ReadFile(filepath.Join(toolsRoot(), p.File))
		if err != nil {
			reports = append(reports, "fail:"+p.Name+": unreadable")
			continue
		}
		out, err := evalScript(ctx, wsURL, string(b), timeout)
		if err != nil {
			reports = append(reports, "fail:"+p.Name+": "+firstLine(err.Error()))
			continue
		}
		got := false
		for _, ln := range strings.Split(out, "\n") {
			ln = strings.TrimSpace(ln)
			if strings.HasPrefix(ln, "ok:") && len(ln) > 3 {
				injected = append(injected, strings.TrimSpace(ln[3:]))
				got = true
			}
		}
		if got {
			reports = append(reports, "ok:"+p.Name)
		} else {
			reports = append(reports, "fail:"+p.Name+": "+firstLine(out))
		}
	}
	recordCustomTools(session, injected)
	return injected, reports
}

// injectCustomToolsForURL injects every custom tool file matching the page
// host, verified or not. Explicit loads only; `open` uses the verified gate.
func injectCustomToolsForURL(ctx context.Context, session, wsURL, pageURL string, timeout time.Duration) ([]string, []string) {
	tools, err := loadCustomTools()
	if err != nil || len(tools) == 0 {
		return nil, nil
	}
	matched := customToolsForHost(hostOfURL(pageURL), tools)
	if len(matched) == 0 {
		return nil, nil
	}
	return injectCustomTools(ctx, session, wsURL, matched, timeout)
}

// ensureCustomTools re-injects session-recorded custom tools that are
// missing from the live page (full navigations drop per-document
// registrations). Returns the refreshed tool list when it injected.
func ensureCustomTools(ctx context.Context, session, wsURL, pageURL string, timeout time.Duration, tools []WebMCPTool) []WebMCPTool {
	recorded := customToolNames(session)
	if len(recorded) == 0 {
		return tools
	}
	have := map[string]bool{}
	for _, tl := range tools {
		have[tl.Name] = true
	}
	missing := false
	for n := range recorded {
		if !have[n] {
			missing = true
			break
		}
	}
	if !missing {
		return tools
	}
	injected, _ := injectCustomToolsForURL(ctx, session, wsURL, pageURL, timeout)
	if len(injected) == 0 {
		return tools
	}
	if relisted, _, err := listWebMCP(ctx, wsURL, timeout); err == nil && relisted != nil {
		return relisted
	}
	return tools
}

// detectBotWall reports challenge/bot-check pages where further action
// burns steps for nothing (verified in traces: anomaly loops collapse
// decision confidence toward zero). URL markers are decisive; text
// markers require a challenged look, not a passing mention.
func detectBotWall(url, text string) bool {
	u := strings.ToLower(url)
	for _, m := range []string{"anomaly.js", "cf-challenge", "challenge-platform", "turnstile", "/challenge", "captcha", "robot-check", "are-you-a-robot"} {
		if strings.Contains(u, m) {
			return true
		}
	}
	t := strings.ToLower(text)
	markers := []string{
		"verify you are human", "verify you're human", "verify that you are human",
		"complete the captcha", "are you a robot", "i am not a robot",
		"cloudflare", "checking your browser", "attention required",
	}
	hits := 0
	for _, m := range markers {
		if strings.Contains(t, m) {
			hits++
		}
	}
	return hits >= 2
}

// injectVerifiedForURL injects only verified custom tools for the host.
// This is the `open` path: unverified tools never auto-inject.
func injectVerifiedForURL(ctx context.Context, session, wsURL, pageURL string, timeout time.Duration) ([]string, []string) {
	tools, err := loadCustomTools()
	if err != nil || len(tools) == 0 {
		return nil, nil
	}
	matched := verifiedToolsForHost(hostOfURL(pageURL), tools)
	if len(matched) == 0 {
		return nil, nil
	}
	return injectCustomTools(ctx, session, wsURL, matched, timeout)
}

func toolsCmd(ctx context.Context, g *globals, rest []string) int {
	if len(rest) == 0 {
		return fail("usage", "usage: agent-webmcp tools <add|list|load|remove|verify> ...")
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	switch rest[0] {
	case "list", "ls":
		tools, err := loadCustomTools()
		if err != nil {
			return failErr("tools_failed", err)
		}
		if g.json {
			if tools == nil {
				tools = []toolMeta{}
			}
			ok(map[string]any{"customTools": tools})
			return 0
		}
		if len(tools) == 0 {
			fmt.Println("no custom tools")
			return 0
		}
		for _, p := range tools {
			mark := ""
			if p.Verified {
				mark = "  [verified " + p.VerifiedAt + "]"
			}
			fmt.Printf("%s  hosts=%s  file=%s%s\n", p.Name, strings.Join(p.Hosts, ","), p.File, mark)
		}
		return 0
	case "add":
		var file string
		for _, a := range rest[1:] {
			if !strings.HasPrefix(a, "-") && file == "" {
				file = a
			}
		}
		if file == "" {
			return fail("usage", "usage: agent-webmcp tools add <file.js> --for <host>[,<host>] [--name NAME]")
		}
		forHosts, _ := verbFlag(rest, "for")
		if strings.TrimSpace(forHosts) == "" {
			return fail("usage", "usage: agent-webmcp tools add <file.js> --for <host>[,<host>] [--name NAME]")
		}
		name, _ := verbFlag(rest, "name")
		if name == "" {
			base := filepath.Base(file)
			name = strings.TrimSuffix(base, filepath.Ext(base))
		}
		name = sanitizeToolName(name)
		src, err := os.ReadFile(file)
		if err != nil {
			return failErr("tools_failed", err)
		}
		if len(src) == 0 {
			return fail("tools_failed", "custom tool file is empty")
		}
		var hosts []string
		for _, h := range strings.Split(forHosts, ",") {
			if h = normalizeHost(h); h != "" {
				hosts = append(hosts, h)
			}
		}
		if len(hosts) == 0 {
			return fail("tools_failed", "no valid hosts in --for")
		}
		if err := os.MkdirAll(toolsRoot(), 0o755); err != nil {
			return failErr("tools_failed", err)
		}
		jsName := name + ".js"
		if err := os.WriteFile(filepath.Join(toolsRoot(), jsName), src, 0o644); err != nil {
			return failErr("tools_failed", err)
		}
		meta := toolMeta{Name: name, Hosts: hosts, File: jsName, Added: time.Now().UTC().Format(time.RFC3339)}
		mb, _ := json.MarshalIndent(meta, "", "  ")
		if err := os.WriteFile(filepath.Join(toolsRoot(), name+".json"), mb, 0o644); err != nil {
			return failErr("tools_failed", err)
		}
		if g.json {
			ok(map[string]any{"custom tool": meta})
			return 0
		}
		fmt.Printf("custom tool %s added for %s\n", name, strings.Join(hosts, ","))
		return 0
	case "remove", "rm":
		if len(rest) < 2 || strings.HasPrefix(rest[1], "-") {
			return fail("usage", "usage: agent-webmcp tools remove <name>")
		}
		name := sanitizeToolName(rest[1])
		_ = os.Remove(filepath.Join(toolsRoot(), name+".js"))
		if err := os.Remove(filepath.Join(toolsRoot(), name+".json")); err != nil {
			return fail("tools_failed", "no such custom tool: "+name)
		}
		if g.json {
			ok(map[string]any{"removed": name})
			return 0
		}
		fmt.Printf("custom tool %s removed\n", name)
		return 0
	case "load":
		port, err := readPort(g.session)
		if err != nil {
			return failErr("no_session", err)
		}
		t, err := pickPageTarget(port)
		if err != nil {
			return failErr("no_page", err)
		}
		injected, reports := injectCustomToolsForURL(ctx, g.session, t.WebSocketDebuggerURL, t.URL, timeout)
		if g.json {
			ok(map[string]any{"session": g.session, "url": t.URL, "injected": injected, "reports": reports})
			return 0
		}
		if len(injected) == 0 {
			if listed, _, lerr := listWebMCP(ctx, t.WebSocketDebuggerURL, timeout); lerr == nil {
				have := map[string]bool{}
				for _, tl := range listed {
					have[tl.Name] = true
				}
				ready := true
				for n := range customToolNames(g.session) {
					if !have[n] {
						ready = false
						break
					}
				}
				if ready && len(customToolNames(g.session)) > 0 {
					fmt.Printf("custom tools already loaded on %s\n", t.URL)
					return 0
				}
			}
			fmt.Printf("no custom tools matched %s\n", t.URL)
			return 0
		}
		fmt.Printf("injected %d tool(s): %s\n", len(injected), strings.Join(injected, ", "))
		return 0
	case "verify":
		// Minimal verification: inject into the live session page and
		// confirm every expected tool registers. Deeper smoke cases
		// (per-tool invocations) come with the authoring pipeline.
		if len(rest) < 2 || strings.HasPrefix(rest[1], "-") {
			return fail("usage", "usage: agent-webmcp tools verify <name> [--url URL] [--session NAME]")
		}
		name := sanitizeToolName(rest[1])
		tools, err := loadCustomTools()
		if err != nil {
			return failErr("tools_failed", err)
		}
		var meta *toolMeta
		for i := range tools {
			if tools[i].Name == name {
				meta = &tools[i]
				break
			}
		}
		if meta == nil {
			return fail("tools_failed", "no such custom tool: "+name)
		}
		if u, ok := verbFlag(rest, "url"); ok && u != "" {
			if !strings.Contains(u, "://") {
				u = "https://" + u
			}
			meta.TestURL = u
		}
		port, err := readPort(g.session)
		if err != nil {
			return failErr("no_session", err)
		}
		t, err := pickPageTarget(port)
		if err != nil {
			return failErr("no_page", err)
		}
		if meta.TestURL != "" && !strings.HasPrefix(t.URL, meta.TestURL) && hostOfURL(t.URL) != hostOfURL(meta.TestURL) {
			return fail("tools_failed", "session is on "+t.URL+" but this tool maps to "+strings.Join(meta.Hosts, ","))
		}
		// Fresh document: reload so earlier injections can't collide as
		// "Duplicate tool name" and the check reflects a clean open.
		if _, err := openURL(ctx, g.session, t.URL, g.chrome, g.headed, timeout); err != nil {
			return failErr("open_failed", err)
		}
		if port, err := readPort(g.session); err == nil {
			if nt, err := pickPageTarget(port); err == nil {
				t = nt
			}
		}
		injected, reports := injectCustomTools(ctx, g.session, t.WebSocketDebuggerURL, []toolMeta{*meta}, timeout)
		present, _, lerr := listWebMCP(ctx, t.WebSocketDebuggerURL, timeout)
		verified := lerr == nil && len(injected) > 0
		if verified {
			have := map[string]bool{}
			for _, tl := range present {
				have[tl.Name] = true
			}
			for _, n := range injected {
				if !have[n] {
					verified = false
					reports = append(reports, "fail:"+n+": registered but not listed")
				}
			}
		}
		meta.Verified = verified
		if verified {
			meta.VerifiedAt = time.Now().UTC().Format(time.RFC3339)
		} else {
			meta.VerifiedAt = ""
		}
		mb, _ := json.MarshalIndent(meta, "", "  ")
		_ = os.WriteFile(filepath.Join(toolsRoot(), meta.Name+".json"), mb, 0o644)
		if g.json {
			ok(map[string]any{"tool": meta.Name, "verified": verified, "injected": injected, "reports": reports})
			return 0
		}
		if verified {
			fmt.Printf("custom tool %s verified on %s (%d tool(s))\n", meta.Name, t.URL, len(injected))
			return 0
		}
		fmt.Printf("custom tool %s NOT verified: %s\n", meta.Name, strings.Join(reports, "; "))
		return 1
	default:
		return fail("usage", "usage: agent-webmcp tools <add|list|load|remove|verify> ...")
	}
}
