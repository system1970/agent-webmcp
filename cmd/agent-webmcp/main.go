package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

const version = "0.3.0"

func usage() {
	fmt.Fprint(os.Stderr, `agent-webmcp `+version+` — typed WebMCP bridge

usage:
  agent-webmcp open [url] [--session NAME] [--headed] [--chrome PATH] [--json]
  agent-webmcp list [--session NAME] [--json]
  agent-webmcp invoke <tool> [--params JSON|@file] [--frame ID] [--session NAME] [--json]
  agent-webmcp eval <js|@file> [--session NAME] [--json]
  agent-webmcp observe [--session NAME] [--json]
  agent-webmcp recon [--session NAME] [--json]
  agent-webmcp decide --goal ".." [--session NAME] [--json]
  agent-webmcp act [--session NAME] [--json]
  agent-webmcp tick --goal ".." [--session NAME] [--json]
  agent-webmcp run --goal ".." [--session NAME] [--max-steps N] [--json]
  agent-webmcp tools <add|list|load|remove|verify> [--session NAME] [--json]
  agent-webmcp close [--session NAME | --all]
  agent-webmcp sessions [--json]
  agent-webmcp status [--session NAME] [--json]
  agent-webmcp version
`)
}

type globals struct {
	session   string
	json      bool
	chrome    string
	headed    bool
	timeoutMs int
	all       bool
	params    string
	frame     string
	text      string
}

func parseGlobals(args []string) (globals, []string) {
	g := globals{session: "default", timeoutMs: 30000}
	if v := os.Getenv("AGENT_WEBMCP_SESSION"); v != "" {
		g.session = v
	}
	var rest []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--session" || a == "-s":
			if i+1 < len(args) {
				i++
				g.session = args[i]
			}
		case strings.HasPrefix(a, "--session="):
			g.session = strings.TrimPrefix(a, "--session=")
		case a == "--json":
			g.json = true
		case a == "--headed":
			g.headed = true
		case a == "--headless":
			g.headed = false
		case a == "--all":
			g.all = true
		case a == "--params":
			if i+1 < len(args) {
				i++
				g.params = args[i]
			}
		case strings.HasPrefix(a, "--params="):
			g.params = strings.TrimPrefix(a, "--params=")
		case a == "--frame":
			if i+1 < len(args) {
				i++
				g.frame = args[i]
			}
		case a == "--text":
			if i+1 < len(args) {
				i++
				g.text = args[i]
			}
		case strings.HasPrefix(a, "--text="):
			g.text = strings.TrimPrefix(a, "--text=")
		case strings.HasPrefix(a, "--frame="):
			g.frame = strings.TrimPrefix(a, "--frame=")
		case a == "--chrome":
			if i+1 < len(args) {
				i++
				g.chrome = args[i]
			}
		case strings.HasPrefix(a, "--chrome="):
			g.chrome = strings.TrimPrefix(a, "--chrome=")
		case a == "--timeout-ms":
			if i+1 < len(args) {
				i++
				if n, err := parseInt(args[i]); err == nil && n > 0 {
					g.timeoutMs = n
				}
			}
		case strings.HasPrefix(a, "--timeout-ms="):
			if n, err := parseInt(strings.TrimPrefix(a, "--timeout-ms=")); err == nil && n > 0 {
				g.timeoutMs = n
			}
		default:
			rest = append(rest, a)
		}
	}
	if g.timeoutMs <= 0 {
		g.timeoutMs = 30000
	}
	return g, rest
}

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 {
		usage()
		return 2
	}
	g, rest := parseGlobals(args[1:])
	jsonOut = g.json
	ctx := context.Background()

	switch args[0] {
	case "version", "--version", "-V":
		fmt.Println("agent-webmcp " + version)
		return 0
	case "help", "--help", "-h":
		usage()
		return 0
	case "open", "navigate", "goto":
		var url string
		for _, a := range rest {
			if !strings.HasPrefix(a, "-") && url == "" {
				url = a
			}
		}
		if url != "" && !strings.Contains(url, "://") && !strings.HasPrefix(url, "about:") && !strings.HasPrefix(url, "data:") {
			url = "https://" + url
		}
		r, err := openURL(ctx, g.session, url, g.chrome, g.headed, 15*time.Second)
		if err != nil {
			return failErr("open_failed", err)
		}
		// Auto-inject verified custom tools for the mapped site.
		// Best-effort: an injection failure never fails the open.
		var injected []string
		if port, perr := readPort(g.session); perr == nil {
			if t, terr := pickPageTarget(port); terr == nil {
				injected, _ = injectVerifiedForURL(ctx, g.session, t.WebSocketDebuggerURL, t.URL, 15*time.Second)
			}
		}
		if g.json {
			ok(map[string]any{"session": r.Session, "url": r.URL, "port": r.Port, "headed": r.Headed, "reused": r.Reused, "customTools": injected})
			return 0
		}
		fmt.Printf("session=%s port=%d url=%s\n", r.Session, r.Port, r.URL)
		if len(injected) > 0 {
			fmt.Printf("custom tools: injected %d tool(s)\n", len(injected))
		}
		return 0
	case "close", "quit", "exit":
		if g.all {
			dirs, _ := sessionNames()
			for _, name := range dirs {
				_ = closeSession(name)
			}
			if g.json {
				ok(map[string]any{"closed": dirs})
				return 0
			}
			fmt.Printf("closed %d session(s)\n", len(dirs))
			return 0
		}
		if err := closeSession(g.session); err != nil {
			return failErr("close_failed", err)
		}
		if g.json {
			ok(map[string]any{"session": g.session, "closed": true})
			return 0
		}
		fmt.Printf("closed session=%s\n", g.session)
		return 0
	case "sessions", "session":
		type row struct {
			Name string `json:"name"`
			Live bool   `json:"live"`
			Port int    `json:"port,omitempty"`
			URL  string `json:"url,omitempty"`
		}
		var rows []row
		for _, name := range mustSessionNames() {
			r := row{Name: name}
			if port, err := readPort(name); err == nil {
				if targets, err := listTargets(port); err == nil {
					r.Live, r.Port = true, port
					for _, t := range targets {
						if t.Type == "page" {
							r.URL = t.URL
							break
						}
					}
				}
			}
			rows = append(rows, r)
		}
		if rows == nil {
			rows = []row{}
		}
		if g.json {
			ok(map[string]any{"sessions": rows})
			return 0
		}
		if len(rows) == 0 {
			fmt.Println("no sessions")
			return 0
		}
		for _, r := range rows {
			state := "dead"
			if r.Live {
				state = "live"
			}
			fmt.Printf("%s  %s  %s\n", r.Name, state, r.URL)
		}
		return 0
	case "status":
		port, err := readPort(g.session)
		if err != nil {
			return failErr("no_session", err)
		}
		targets, err := listTargets(port)
		if err != nil {
			return failErr("unreachable", err)
		}
		pages, url := 0, ""
		for _, t := range targets {
			if t.Type == "page" {
				pages++
				if url == "" {
					url = t.URL
				}
			}
		}
		if g.json {
			ok(map[string]any{"session": g.session, "port": port, "pages": pages, "url": url})
			return 0
		}
		fmt.Printf("session=%s port=%d pages=%d url=%s\n", g.session, port, pages, url)
		return 0
	case "list", "webmcp":		// `webmcp list` compat with agent-browser.
		if args[0] == "webmcp" && len(rest) > 0 && rest[0] == "list" {
			rest = rest[1:]
		}
		port, err := readPort(g.session)
		if err != nil {
			return failErr("no_session", err)
		}
		t, err := pickPageTarget(port)
		if err != nil {
			return failErr("no_page", err)
		}
		tools, _, err := listWebMCP(ctx, t.WebSocketDebuggerURL, time.Duration(g.timeoutMs)*time.Millisecond)
		if err != nil {
			if isNotFound(err) {
				return fail("webmcp_unsupported", "browser has no WebMCP CDP domain (use Chrome 149+)")
			}
			return failErr("list_failed", err)
		}
		if tools == nil {
			tools = []WebMCPTool{}
		}
		custom := customToolNames(g.session)
		if g.json {
			names := []string{}
			for _, tl := range tools {
				if custom[tl.Name] {
					names = append(names, tl.Name)
				}
			}
			ok(map[string]any{"session": g.session, "url": t.URL, "tools": tools, "custom": names})
			return 0
		}
		if len(tools) == 0 {
			fmt.Println("webmcp: no tools registered on this page")
			return 0
		}
		fmt.Printf("webmcp: %d tool(s) on %s\n", len(tools), t.URL)
		for _, tl := range tools {
			tag := ""
			if custom[tl.Name] {
				tag = " [custom: agent-webmcp custom tool, not the site's]"
			}
			fmt.Printf("  - %s: %s%s\n", tl.Name, firstLine(tl.Description), tag)
		}
		return 0
	case "invoke":
		if len(rest) == 0 || strings.HasPrefix(rest[0], "-") {
			return fail("usage", "usage: agent-webmcp invoke <tool> [--params JSON|@file] [--frame ID]")
		}
		tool, params := rest[0], g.params
		if params == "" && len(rest) > 1 && !strings.HasPrefix(rest[1], "-") {
			params = rest[1]
		}
		port, err := readPort(g.session)
		if err != nil {
			return failErr("no_session", err)
		}
		t, err := pickPageTarget(port)
		if err != nil {
			return failErr("no_page", err)
		}
		// Self-healing invoke: a full navigation drops per-document custom
		// tools. If the named tool is session-recorded but absent, re-inject
		// silently and proceed instead of failing on a stale page.
		if listed, _, lerr := listWebMCP(ctx, t.WebSocketDebuggerURL, time.Duration(g.timeoutMs)*time.Millisecond); lerr == nil {
			ensureCustomTools(ctx, g.session, t.WebSocketDebuggerURL, t.URL, time.Duration(g.timeoutMs)*time.Millisecond, listed)
		}
		raw, err := invokeWebMCP(ctx, t.WebSocketDebuggerURL, tool, params, g.frame, time.Duration(g.timeoutMs)*time.Millisecond)
		if err != nil {
			return failErr("invoke_failed", err)
		}
		var val any = string(raw)
		var js any
		if json.Unmarshal(raw, &js) == nil {
			val = js
		}
		if g.json {
			ok(map[string]any{"tool": tool, "result": val})
			return 0
		}
		fmt.Println(string(raw))
		return 0
	case "eval":
		return evalCmd(ctx, &g, rest)
	case "observe":
		return observeCmd(ctx, &g, rest)
	case "recon":
		return reconCmd(ctx, &g, rest)
	case "decide":
		return decideCmd(ctx, &g, rest)
	case "act":
		return actCmd(ctx, &g, rest)
	case "tick":
		return tickCmd(ctx, &g, rest)
	case "run":
		return runCmd(ctx, &g, rest)
	case "tools":
		return toolsCmd(ctx, &g, rest)
	default:
		usage()
		return 2
	}
}
