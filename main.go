package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed skills/agent-webmcp/SKILL.md skills/agent-webmcp/references/*.md
var skillFS embed.FS

var skillTopics = []struct {
	name string
	file string
	desc string
}{
	{"webmcp", "skills/agent-webmcp/SKILL.md", "Core procedure: read-act-verify loop, discovery, policy, security"},
	{"webmcp-protocol", "skills/agent-webmcp/references/protocol.md", "Result shapes, async effects, params/quoting, latency"},
	{"webmcp-cli", "skills/agent-webmcp/references/cli.md", "Flags, sessions, eval, MCP bridge config"},
	{"webmcp-troubleshooting", "skills/agent-webmcp/references/troubleshooting.md", "Error codes and failure recovery"},
}

func skillRead(name string) (string, bool) {
	for _, t := range skillTopics {
		if t.name == name || (name == "agent-webmcp" && t.name == "webmcp") {
			b, err := skillFS.ReadFile(t.file)
			if err != nil {
				return "", false
			}
			return string(b), true
		}
	}
	return "", false
}

const version = "0.1.0"

func usage() {
	fmt.Fprint(os.Stderr, `agent-webmcp `+version+` — ultra-light WebMCP browser CLI

usage:
  agent-webmcp open [url] [--session NAME] [--headed] [--chrome PATH] [--json]
  agent-webmcp list [--session NAME] [--json]
  agent-webmcp invoke <tool> [--session NAME] [--params JSON|@file] [--frame ID] [--timeout-ms N] [--json]
  agent-webmcp eval <js|@file> [--session NAME] [--json]
  agent-webmcp tools <add <file> [--for HOST] [--name NAME] | list | load | remove <name>>
  agent-webmcp close [--session NAME | --all]
  agent-webmcp close [--session NAME | --all]
  agent-webmcp sessions [--json]
  agent-webmcp status [--session NAME] [--json]
  agent-webmcp mcp [--session NAME]
  agent-webmcp skills [get <name>]
  agent-webmcp version

env:
  AGENT_WEBMCP_CHROME  chrome binary path
  AGENT_WEBMCP_HOME    sessions root override
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
		case strings.HasPrefix(a, "-s="):
			g.session = strings.TrimPrefix(a, "-s=")
		case a == "--json":
			g.json = true
		case a == "--headed":
			g.headed = true
		case a == "--headless":
			g.headed = false
		case a == "--all":
			g.all = true
		case a == "--chrome":
			if i+1 < len(args) {
				i++
				g.chrome = args[i]
			}
		case strings.HasPrefix(a, "--chrome="):
			g.chrome = strings.TrimPrefix(a, "--chrome=")
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
		case strings.HasPrefix(a, "--frame="):
			g.frame = strings.TrimPrefix(a, "--frame=")
		case a == "--timeout-ms":
			if i+1 < len(args) {
				i++
				fmt.Sscanf(args[i], "%d", &g.timeoutMs)
			}
		case strings.HasPrefix(a, "--timeout-ms="):
			fmt.Sscanf(strings.TrimPrefix(a, "--timeout-ms="), "%d", &g.timeoutMs)
		case a == "--help" || a == "-h":
			rest = append(rest, a)
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
	cmd := args[0]
	ctx := context.Background()

	switch cmd {
	case "version", "--version", "-V":
		fmt.Println("agent-webmcp " + version)
		return 0
	case "help", "--help", "-h":
		usage()
		return 0
	case "open", "navigate", "goto":
		var url string
		for _, a := range rest {
			if a == "--help" || a == "-h" {
				usage()
				return 0
			}
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
		if g.json {
			ok(r)
			return 0
		}
		fmt.Printf("session=%s port=%d url=%s\n", r.Session, r.Port, r.URL)
		for _, c := range r.Custom {
			fmt.Printf("custom: %s\n", c)
		}
		if n := r.WebMCP["toolCount"]; n == 0 {
			fmt.Println("webmcp: no tools (run: agent-webmcp list)")
		} else {
			fmt.Printf("webmcp: %v tool(s) available — run: agent-webmcp list\n", n)
			for _, t := range r.Tools {
				fmt.Printf("  - %s: %s\n", t.Name, firstLine(t.Description))
			}
		}
		return 0
	case "list", "webmcp":
		// `webmcp list` compat
		if len(rest) > 0 && rest[0] == "list" {
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
		lctx, cancel := context.WithTimeout(ctx, time.Duration(g.timeoutMs)*time.Millisecond)
		defer cancel()
		tools, code, err := listWebMCP(lctx, t.WebSocketDebuggerURL)
		if err != nil {
			if code == "webmcp_unsupported" || isNotFound(err) {
				return fail("webmcp_unsupported", "browser build has no WebMCP CDP domain (use newer Chrome, headed or headless=new with WebMCP flags)")
			}
			return failErr("list_failed", err)
		}
		tools = markOverlays(tools, readOverlayTools(g.session))
		if g.json {
			ok(map[string]any{"session": g.session, "url": t.URL, "tools": tools})
			return 0
		}
		if len(tools) == 0 {
			fmt.Println("webmcp: no tools registered on this page")
			return 0
		}
		fmt.Printf("webmcp: %d tool(s) on %s\n", len(tools), t.URL)
		for _, tl := range tools {
			ro := ""
			if tl.ReadOnly != nil && *tl.ReadOnly {
				ro = " [read-only]"
			}
			ov := ""
			if tl.Overlay != nil && *tl.Overlay {
				ov = " [overlay: agent-webmcp custom, not the site's]"
			}
			fmt.Printf("  - %s%s%s: %s\n", tl.Name, ro, ov, firstLine(tl.Description))
		}
		return 0
	case "invoke":
		if len(rest) == 0 || strings.HasPrefix(rest[0], "-") {
			return fail("usage", "usage: agent-webmcp invoke <tool> [--params JSON|@file] [--frame ID]")
		}
		tool := rest[0]
		params := g.params
		// allow positional JSON second arg
		for _, a := range rest[1:] {
			if !strings.HasPrefix(a, "-") && params == "" {
				params = a
			}
		}
		if strings.HasPrefix(params, "@") {
			b, err := os.ReadFile(strings.TrimPrefix(params, "@"))
			if err != nil {
				return failErr("params_read_failed", err)
			}
			params = strings.TrimSpace(strings.TrimPrefix(string(b), "\ufeff"))
		}
		if params == "" {
			params = "{}"
		}
		port, err := readPort(g.session)
		if err != nil {
			return failErr("no_session", err)
		}
		t, err := pickPageTarget(port)
		if err != nil {
			return failErr("no_page", err)
		}
		ictx, cancel := context.WithTimeout(ctx, time.Duration(g.timeoutMs)*time.Millisecond)
		defer cancel()
		raw, err := invokeWebMCP(ictx, t.WebSocketDebuggerURL, tool, params, g.frame, time.Duration(g.timeoutMs)*time.Millisecond)
		if err != nil {
			if isNotFound(err) {
				return fail("webmcp_unsupported", "invoke not supported by this browser build: "+err.Error())
			}
			return failErr("invoke_failed", err)
		}
		if g.json {
			var v any
			if json.Unmarshal(raw, &v) == nil {
				ok(map[string]any{"tool": tool, "result": v})
			} else {
				ok(map[string]any{"tool": tool, "result": string(raw)})
			}
			return 0
		}
		// Human: pretty-print result payload.
		var v any
		if json.Unmarshal(raw, &v) == nil {
			b, _ := json.MarshalIndent(v, "", "  ")
			fmt.Println(string(b))
		} else {
			fmt.Println(string(raw))
		}
		return 0
	case "close", "quit", "exit":
		if g.all {
			root := sessionRoot()
			ents, _ := os.ReadDir(root)
			for _, e := range ents {
				if e.IsDir() {
					_ = closeSession(e.Name())
				}
			}
			if g.json {
				ok(map[string]any{"closed": "all"})
			} else {
				fmt.Println("closed all sessions")
			}
			return 0
		}
		if err := closeSession(g.session); err != nil {
			return failErr("close_failed", err)
		}
		if g.json {
			ok(map[string]any{"closed": g.session})
		} else {
			fmt.Println("closed session " + g.session)
		}
		return 0
	case "sessions", "session":
		if len(rest) > 0 && rest[0] == "list" {
			rest = rest[1:]
		}
		root := sessionRoot()
		ents, _ := os.ReadDir(root)
		type row struct {
			Name  string `json:"name"`
			Live  bool   `json:"live"`
			Port  int    `json:"port,omitempty"`
			URL   string `json:"url,omitempty"`
		}
		var rows []row
		for _, e := range ents {
			if !e.IsDir() {
				continue
			}
			r := row{Name: e.Name()}
			if p, err := readPort(e.Name()); err == nil {
				r.Port = p
				if ts, err := listTargets(p); err == nil {
					r.Live = true
					for _, t := range ts {
						if t.Type == "page" {
							r.URL = t.URL
							break
						}
					}
				}
			}
			rows = append(rows, r)
		}
		if g.json {
			if rows == nil {
				rows = []row{}
			}
			ok(map[string]any{"sessions": rows})
			return 0
		}
		if len(rows) == 0 {
			fmt.Println("no sessions")
			return 0
		}
		for _, r := range rows {
			st := "dead"
			if r.Live {
				st = "live :" + itoa(r.Port) + " " + r.URL
			}
			fmt.Printf("  %s  %s\n", r.Name, st)
		}
		return 0
	case "status":
		port, err := readPort(g.session)
		if err != nil {
			return failErr("no_session", err)
		}
		ts, err := listTargets(port)
		if err != nil {
			return failErr("cdp_unreachable", err)
		}
		pages := 0
		active := ""
		for _, t := range ts {
			if t.Type == "page" {
				pages++
				if active == "" {
					active = t.URL
				}
			}
		}
		if g.json {
			ok(map[string]any{"session": g.session, "port": port, "pages": pages, "url": active, "profile": filepath.Join(sessionDir(g.session), "profile")})
		} else {
			fmt.Printf("session=%s port=%d pages=%d url=%s\n", g.session, port, pages, active)
		}
		return 0
	case "mcp":
		return mcpServe(g.session)
	case "skills":
		want := ""
		full := false
		for _, a := range rest {
			switch {
			case a == "list" || a == "get":
				continue
			case a == "--full" || a == "--all":
				full = true
			case !strings.HasPrefix(a, "-") && want == "":
				want = a
			}
		}
		if full && (want == "" || want == "webmcp" || want == "agent-webmcp") {
			var b strings.Builder
			for i, t := range skillTopics {
				if i > 0 {
					b.WriteString("\n\n---\n\n")
				}
				content, found := skillRead(t.name)
				if !found {
					return fail("skill_read_failed", "embedded skill missing: "+t.name)
				}
				b.WriteString(content)
			}
			if g.json {
				ok(map[string]any{"name": "webmcp", "full": true, "content": b.String()})
			} else {
				fmt.Print(b.String())
			}
			return 0
		}
		if want == "" {
			if g.json {
				names := make([]string, 0, len(skillTopics))
				for _, t := range skillTopics {
					names = append(names, t.name)
				}
				ok(map[string]any{"skills": names})
			} else {
				fmt.Println("available skills (agent-webmcp skills get <name>):")
				for _, t := range skillTopics {
					fmt.Printf("  %-22s %s\n", t.name, t.desc)
				}
			}
			return 0
		}
		content, found := skillRead(want)
		if !found {
			return fail("unknown_skill", "unknown skill: "+want+" (try: agent-webmcp skills)")
		}
		if g.json {
			ok(map[string]any{"name": want, "content": content})
		} else {
			fmt.Print(content)
		}
		return 0
	case "eval":
		if len(rest) == 0 {
			return fail("usage", "usage: agent-webmcp eval <js|@file> [--session NAME]")
		}
		port, err := readPort(g.session)
		if err != nil {
			return failErr("no_session", err)
		}
		t, err := pickPageTarget(port)
		if err != nil {
			return failErr("no_page", err)
		}
		ectx, cancel := context.WithTimeout(ctx, time.Duration(g.timeoutMs)*time.Millisecond)
		defer cancel()
		expr := strings.Join(rest, " ")
		if len(rest) == 1 && strings.HasPrefix(rest[0], "@") {
			b, err := os.ReadFile(strings.TrimPrefix(rest[0], "@"))
			if err != nil {
				return failErr("eval_read_failed", err)
			}
			expr = strings.TrimSpace(strings.TrimPrefix(string(b), "\ufeff"))
		}
		out, err := evalScript(ectx, t.WebSocketDebuggerURL, expr, time.Duration(g.timeoutMs)*time.Millisecond)
		if err != nil {
			return failErr("eval_failed", err)
		}
		if g.json {
			ok(map[string]any{"value": out})
			return 0
		}
		fmt.Println(out)
		return 0
	case "tools", "tool":
		if len(rest) == 0 {
			return fail("usage", "usage: agent-webmcp tools <add <file> [--for HOST] [--name NAME] | list | load | remove <name>>")
		}
		switch rest[0] {
		case "list":
			packs, err := toolsList()
			if err != nil {
				return failErr("tools_list_failed", err)
			}
			if g.json {
				if packs == nil {
					packs = []packMeta{}
				}
				ok(map[string]any{"packs": packs})
				return 0
			}
			if len(packs) == 0 {
				fmt.Println("no stored custom tools (agent-webmcp tools add <file> --for <host>)")
				return 0
			}
			for _, p := range packs {
				fmt.Printf("  %s  hosts=%s\n", p.Name, strings.Join(p.Hosts, ","))
			}
			return 0
		case "add":
			if len(rest) < 2 || strings.HasPrefix(rest[1], "-") {
				return fail("usage", "usage: agent-webmcp tools add <file> [--for HOST] [--name NAME]")
			}
			file := rest[1]
			var hosts []string
			name := ""
			for i := 2; i < len(rest); i++ {
				switch {
				case rest[i] == "--for" && i+1 < len(rest):
					i++
					hosts = append(hosts, strings.Split(rest[i], ",")...)
				case strings.HasPrefix(rest[i], "--for="):
					hosts = append(hosts, strings.Split(strings.TrimPrefix(rest[i], "--for="), ",")...)
				case rest[i] == "--name" && i+1 < len(rest):
					i++
					name = rest[i]
				case strings.HasPrefix(rest[i], "--name="):
					name = strings.TrimPrefix(rest[i], "--name=")
				}
			}
			saved, err := toolsAdd(file, name, hosts)
			if err != nil {
				return failErr("tools_add_failed", err)
			}
			loaded := ""
			if port, err := readPort(g.session); err == nil {
				if t, err := pickPageTarget(port); err == nil && t.URL != "" {
					for _, line := range loadPacks(ctx, t.WebSocketDebuggerURL, hostOfURL(t.URL)) {
						if strings.HasPrefix(line, saved+":") {
							loaded = strings.TrimSpace(strings.TrimPrefix(line, saved+":"))
						}
					}
				}
			}
			if g.json {
				ok(map[string]any{"pack": saved, "hosts": hosts, "loaded": loaded})
			} else if loaded != "" {
				fmt.Printf("stored %s and loaded into current tab: %s\n", saved, loaded)
			} else {
				fmt.Printf("stored %s (loads automatically when you open a matching site)\n", saved)
			}
			return 0
		case "remove", "rm", "delete":
			if len(rest) < 2 {
				return fail("usage", "usage: agent-webmcp tools remove <name>")
			}
			if err := toolsRemove(rest[1]); err != nil {
				return failErr("tools_remove_failed", err)
			}
			if g.json {
				ok(map[string]any{"removed": packName(rest[1])})
			} else {
				fmt.Println("removed " + packName(rest[1]) + " (live tabs keep it until reload)")
			}
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
			done := loadPacks(ctx, t.WebSocketDebuggerURL, hostOfURL(t.URL))
			recordOverlayTools(g.session, done)
			if g.json {
				ok(map[string]any{"host": hostOfURL(t.URL), "loaded": done})
			} else if len(done) == 0 {
				fmt.Println("no stored tools match " + hostOfURL(t.URL))
			} else {
				for _, d := range done {
					fmt.Println("  " + d)
				}
			}
			return 0
		}
		return fail("usage", "usage: agent-webmcp tools <add|list|load|remove>")
	}
	return fail("unknown_command", "unknown command: "+cmd+" (run: agent-webmcp help)")
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	if len(s) > 160 {
		return strings.TrimSpace(s[:160]) + "…"
	}
	return strings.TrimSpace(s)
}
