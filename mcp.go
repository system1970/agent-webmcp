package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Minimal MCP (2024-11/2025) stdio server: initialize, tools/list, tools/call, ping.
// Only exposes the WebMCP-focused surface to keep agent context tiny and fast.

type mcpReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

func mcpServe(defaultSession string) int {
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 64*1024), 10*1024*1024)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	enc := json.NewEncoder(out)
	enc.SetEscapeHTML(false)
	respond := func(id any, result any) {
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
		_ = out.Flush()
	}
	respondErr := func(id any, code int, msg string) {
		_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}})
		_ = out.Flush()
	}
	for in.Scan() {
		line := in.Bytes()
		if len(line) == 0 {
			continue
		}
		var r mcpReq
		if err := json.Unmarshal(line, &r); err != nil {
			continue
		}
		// Notifications have no id -> no response.
		isNotif := r.ID == nil
		switch r.Method {
		case "initialize":
			respond(r.ID, map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "agent-webmcp", "version": version},
			})
		case "notifications/initialized", "notifications/cancelled":
			// no-op
		case "ping":
			if !isNotif {
				respond(r.ID, map[string]any{})
			}
		case "tools/list":
			if !isNotif {
				respond(r.ID, map[string]any{"tools": mcpTools()})
			}
		case "tools/call":
			if isNotif {
				continue
			}
			var p struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			_ = json.Unmarshal(r.Params, &p)
			res, err := mcpCallTool(defaultSession, p.Name, p.Arguments)
			if err != nil {
				respondErr(r.ID, -32603, err.Error())
				continue
			}
			respond(r.ID, res)
		default:
			if !isNotif {
				respondErr(r.ID, -32601, "method not found: "+r.Method)
			}
		}
	}
	return 0
}

func mcpTools() []any {
	str := map[string]any{"type": "string"}
	return []any{
		map[string]any{"name": "open", "description": "Launch/connect browser session and navigate. Returns WebMCP availability.", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"url": str, "session": str, "headed": map[string]any{"type": "boolean"}}}},
		map[string]any{"name": "list_webmcp_tools", "description": "List page-registered WebMCP tools for the session's active tab.", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"session": str}}},
		map[string]any{"name": "execute_webmcp_tool", "description": "Invoke a page WebMCP tool. input is a JSON object.", "inputSchema": map[string]any{"type": "object", "required": []string{"toolName"}, "properties": map[string]any{"toolName": str, "input": map[string]any{"type": "object"}, "session": str, "frameId": str}}},
		map[string]any{"name": "close", "description": "Close a browser session.", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{"session": str}}},
	}
}

func mcpStr(args map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := args[k]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

func mcpCallTool(defSession, name string, args map[string]any) (any, error) {
	if args == nil {
		args = map[string]any{}
	}
	session := mcpStr(args, "session")
	if session == "" {
		session = defSession
	}
	if session == "" {
		session = "default"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	text := func(s string) any {
		return map[string]any{"content": []any{map[string]any{"type": "text", "text": s}}}
	}
	switch name {
	case "open":
		url := mcpStr(args, "url")
		headed := false
		if v, ok := args["headed"].(bool); ok {
			headed = v
		}
		r, err := openURL(ctx, session, url, "", headed, 15*time.Second)
		if err != nil {
			return nil, err
		}
		b, _ := json.Marshal(r)
		return text(string(b)), nil
	case "list_webmcp_tools":
		port, err := readPort(session)
		if err != nil {
			return nil, err
		}
		t, err := pickPageTarget(port)
		if err != nil {
			return nil, err
		}
		tools, _, err := listWebMCP(ctx, t.WebSocketDebuggerURL)
		if err != nil {
			return nil, err
		}
		tools = markPacks(tools, readPackTools(session))
		b, _ := json.Marshal(tools)
		return text(string(b)), nil
	case "execute_webmcp_tool":
		tool := mcpStr(args, "toolName", "tool", "name")
		if tool == "" {
			return nil, fmt.Errorf("toolName required")
		}
		var inputJSON = "{}"
		if iv, ok := args["input"]; ok && iv != nil {
			if b, err := json.Marshal(iv); err == nil {
				inputJSON = string(b)
			}
		}
		frame := mcpStr(args, "frameId", "frame")
		port, err := readPort(session)
		if err != nil {
			return nil, err
		}
		t, err := pickPageTarget(port)
		if err != nil {
			return nil, err
		}
		raw, err := invokeWebMCP(ctx, t.WebSocketDebuggerURL, tool, inputJSON, frame, 30*time.Second)
		if err != nil {
			return nil, err
		}
		return text(string(raw)), nil
	case "close":
		if err := closeSession(session); err != nil {
			return nil, err
		}
		return text(`{"closed":true}`), nil
	}
	return nil, fmt.Errorf("unknown tool: %s", name)
}
