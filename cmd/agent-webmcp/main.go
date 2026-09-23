package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

const version = "0.4.0"

func usage() {
	fmt.Fprint(os.Stderr, `agent-webmcp `+version+` — typed WebMCP bridge

usage:
  agent-webmcp open [url] [--session NAME] [--headed] [--chrome PATH] [--profile NAME] [--json]
  agent-webmcp crawl <url> [--session NAME] [--json]
  agent-webmcp list [--session NAME] [--json]
  agent-webmcp invoke <tool> [--params JSON|@file] [--frame ID] [--session NAME] [--json]
  agent-webmcp eval <js|@file> [--session NAME] [--json]
  agent-webmcp observe [--session NAME] [--json]
  agent-webmcp recon [--session NAME] [--json]
  agent-webmcp decide --goal ".." [--session NAME] [--json]
  agent-webmcp act [--session NAME] [--json]
  agent-webmcp tick --goal ".." [--session NAME] [--json]
  agent-webmcp run --goal ".." [--session NAME] [--max-steps N] [--json]
  agent-webmcp auth <probe|handoff> [--session NAME] [--json]
  agent-webmcp tools <add|list|load|remove|verify> [--session NAME] [--json]
  agent-webmcp tools add --goal "..{{param}}.." --for HOST --name NAME --fields "a,b" [--fill a] [--confirm]
  agent-webmcp close [--session NAME | --all]
  agent-webmcp sessions [--json]
  agent-webmcp status [--session NAME] [--json]
  agent-webmcp version
`)
}

type globals struct {
	session   string
	profile   string
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
		case a == "--profile":
			if i+1 < len(args) {
				i++
				g.profile = args[i]
			}
		case strings.HasPrefix(a, "--profile="):
			g.profile = strings.TrimPrefix(a, "--profile=")
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
	sessionProfile = resolveProfile(&g)
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
		if t, terr := sessionTarget(g.session, 15*time.Second); terr == nil {
			injected, _ = injectVerifiedForURL(ctx, g.session, t.WebSocketDebuggerURL, t.URL, 15*time.Second)
		}
		if g.json {
			ok(map[string]any{"session": r.Session, "profile": r.Profile, "url": r.URL, "port": r.Port, "headed": r.Headed, "reused": r.Reused, "customTools": injected})
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
			killAllProfileBrowsers()
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
			if prof, _, berr := readTargetBinding(name); berr == nil {
				if port, perr := profilePort(prof); perr == nil {
					r.Port = port
				}
			}
			if t, err := sessionTarget(name, 10*time.Second); err == nil {
				r.Live, r.URL = true, t.URL
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
		t, err := sessionTarget(g.session, 10*time.Second)
		if err != nil {
			return failErr("no_page", err)
		}
		profile, pages := "", 0
		if prof, _, berr := readTargetBinding(g.session); berr == nil {
			profile = prof
			if port, perr := profilePort(prof); perr == nil {
				if targets, lerr := listTargets(port); lerr == nil {
					for _, x := range targets {
						if x.Type == "page" {
							pages++
						}
					}
				}
			}
		}
		if g.json {
			ok(map[string]any{"session": g.session, "profile": profile, "tabs": pages, "url": t.URL})
			return 0
		}
		fmt.Printf("session=%s profile=%s tabs=%d url=%s\n", g.session, profile, pages, t.URL)
		return 0
	case "list", "webmcp": // `webmcp list` compat with agent-browser.
		if args[0] == "webmcp" && len(rest) > 0 && rest[0] == "list" {
			rest = rest[1:]
		}
		t, err := sessionTarget(g.session, time.Duration(g.timeoutMs)*time.Millisecond)
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
		loopMatched := []toolMeta{}
		if all, lerr := loadCustomTools(); lerr == nil {
			for _, m := range customToolsForHost(hostOfURL(t.URL), all) {
				if m.Kind == "loop" {
					loopMatched = append(loopMatched, m)
				}
			}
		}
		if g.json {
			names := []string{}
			for _, tl := range tools {
				if custom[tl.Name] {
					names = append(names, tl.Name)
				}
			}
			loopNames := []string{}
			for _, m := range loopMatched {
				loopNames = append(loopNames, m.Name)
			}
			ok(map[string]any{"session": g.session, "url": t.URL, "tools": tools, "custom": names, "loop": loopNames})
			return 0
		}
		if len(tools) == 0 && len(loopMatched) == 0 {
			fmt.Println("webmcp: no tools registered on this page")
			return 0
		}
		fmt.Printf("webmcp: %d tool(s) on %s\n", len(tools)+len(loopMatched), t.URL)
		for _, tl := range tools {
			tag := ""
			if custom[tl.Name] {
				tag = " [custom: agent-webmcp custom tool, not the site's]"
			}
			fmt.Printf("  - %s: %s%s\n", tl.Name, firstLine(tl.Description), tag)
		}
		for _, m := range loopMatched {
			desc := m.Desc
			if desc == "" {
				desc = "loop tool (bounded Jev run)"
			}
			fmt.Printf("  - %s: %s [loop: params %s]\n", m.Name, firstLine(desc), strings.Join(m.Params, ","))
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
		// Loop-backed tools execute a bounded Jev run, not page JS.
		if meta, lerr := findLoopTool(tool); lerr == nil && meta != nil {
			maxSteps := 0
			if v, ok := verbFlag(rest, "max-steps"); ok {
				if n, err := parseInt(v); err == nil && n > 0 && n <= 30 {
					maxSteps = n
				}
			}
			return execLoopTool(ctx, &g, meta, params, maxSteps)
		}
		t, err := sessionTarget(g.session, time.Duration(g.timeoutMs)*time.Millisecond)
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
	case "crawl":
		return crawlCmd(ctx, &g, rest)
	case "auth":
		return authCmd(ctx, &g, rest)
	case "tools":
		return toolsCmd(ctx, &g, rest)
	default:
		usage()
		return 2
	}
}
