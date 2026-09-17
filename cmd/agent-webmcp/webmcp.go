package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// WebMCP discovery over CDP. Chrome 149-152 has no listTools, so list
// enables the domain and collects toolsAdded events: fast path returns
// 300ms after the last arrival, dead window caps empty pages.

type WebMCPTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"inputSchema,omitempty"`
	FrameID     string         `json:"frameId,omitempty"`
	ReadOnly    *bool          `json:"readOnly,omitempty"`
	Untrusted   *bool          `json:"untrustedContent,omitempty"`
}

func boolPtr(b bool) *bool { return &b }

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func isNotFound(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	for _, sub := range []string{"wasn't found", "was not found", "not found", "no such", "unsupported", "invalid method", "method not found"} {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func normalizeTool(name, desc, title string, schema any, frameID string, readOnly, untrusted *bool) WebMCPTool {
	if desc == "" {
		desc = title
	}
	t := WebMCPTool{Name: name, Description: desc, FrameID: frameID, ReadOnly: readOnly, Untrusted: untrusted}
	switch s := schema.(type) {
	case map[string]any:
		t.InputSchema = s
	case string:
		var m map[string]any
		if json.Unmarshal([]byte(s), &m) == nil {
			t.InputSchema = m
		}
	}
	return t
}

func mapRawTool(m map[string]any, frameID string) WebMCPTool {
	str := func(keys ...string) string {
		for _, k := range keys {
			if v, _ := m[k].(string); v != "" {
				return v
			}
		}
		return ""
	}
	var ro, un *bool
	if v, ok := m["readOnlyHint"].(bool); ok {
		ro = boolPtr(v)
	}
	if v, ok := m["readOnly"].(bool); ok {
		ro = boolPtr(v)
	}
	if v, ok := m["untrustedContentHint"].(bool); ok {
		un = boolPtr(v)
	}
	if v, ok := m["untrustedContent"].(bool); ok {
		un = boolPtr(v)
	}
	if ann, ok := m["annotations"].(map[string]any); ok {
		if v, ok := ann["readOnlyHint"].(bool); ok {
			ro = boolPtr(v)
		}
		if v, ok := ann["untrustedContentHint"].(bool); ok {
			un = boolPtr(v)
		}
	}
	return normalizeTool(str("name"), str("description", "title"), str("title"), m["inputSchema"], frameID, ro, un)
}

func listWebMCP(ctx context.Context, wsURL string, timeout time.Duration) ([]WebMCPTool, string, error) {
	dctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	c, err := dialCDP(dctx, wsURL)
	if err != nil {
		return nil, "", err
	}
	defer c.Close()

	ectx, cancel2 := context.WithTimeout(ctx, 2*time.Second)
	defer cancel2()
	_ = mustCall(ectx, c, "WebMCP.enable", nil) // absent domain = older browser; fall through to probe

	// Fast path: listTools on newer builds.
	lctx, cancel3 := context.WithTimeout(ctx, 8*time.Second)
	defer cancel3()
	if raw, err := c.Call(lctx, "WebMCP.listTools", nil); err == nil {
		var out struct {
			Tools []map[string]any `json:"tools"`
		}
		if json.Unmarshal(raw, &out) == nil {
			tools := make([]WebMCPTool, 0, len(out.Tools))
			for _, m := range out.Tools {
				fid, _ := m["frameId"].(string)
				tools = append(tools, mapRawTool(m, fid))
			}
			return tools, "", nil
		}
	} else if !isNotFound(err) {
		return nil, "", err
	}

	// Event path: drain toolsAdded/toolsChanged, honor toolsRemoved.
	seen := map[string]map[string]any{}
	deadline := time.Now().Add(minDuration(timeout, 1500*time.Millisecond))
	quiet := 300 * time.Millisecond
	last := time.Now()
	for {
		remain := time.Until(deadline)
		if remain <= 0 {
			break
		}
		if len(seen) > 0 && time.Since(last) >= quiet {
			break
		}
		wait := remain
		if len(seen) > 0 && time.Until(last.Add(quiet)) < wait {
			wait = time.Until(last.Add(quiet))
		}
		select {
		case ev := <-c.events:
			switch ev.Method {
			case "WebMCP.toolsAdded", "WebMCP.toolsChanged":
				var p struct {
					Tools   []map[string]any `json:"tools"`
					FrameID string            `json:"frameId"`
				}
				if json.Unmarshal(ev.Params, &p) == nil {
					for _, m := range p.Tools {
						fid := p.FrameID
						if v, _ := m["frameId"].(string); v != "" {
							fid = v
						}
						name, _ := m["name"].(string)
						if name != "" {
							seen[name+"\x00"+fid] = m
							if _, ok := m["frameId"]; !ok && fid != "" {
								m["frameId"] = fid
							}
						}
					}
					last = time.Now()
				}
			case "WebMCP.toolsRemoved":
				var p struct {
					Tools   []map[string]any `json:"tools"`
					FrameID string            `json:"frameId"`
				}
				if json.Unmarshal(ev.Params, &p) == nil {
					for _, m := range p.Tools {
						name, _ := m["name"].(string)
						fid := p.FrameID
						if v, _ := m["frameId"].(string); v != "" {
							fid = v
						}
						delete(seen, name+"\x00"+fid)
					}
					last = time.Now()
				}
			}
		case <-time.After(wait):
		case <-dctx.Done():
			goto done
		}
	}
done:
	tools := make([]WebMCPTool, 0, len(seen))
	for key, m := range seen {
		fid := ""
		if i := strings.Index(key, "\x00"); i >= 0 {
			fid = key[i+1:]
		}
		if v, _ := m["frameId"].(string); v != "" {
			fid = v
		}
		tools = append(tools, mapRawTool(m, fid))
	}
	return tools, "", nil
}

func mustCall(ctx context.Context, c *CDP, method string, params map[string]any) error {
	_, err := c.Call(ctx, method, params)
	return err
}

// parseParams: "" -> {}, @file -> BOM-tolerant read, else JSON object.
func parseParams(raw string) (map[string]any, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return map[string]any{}, nil
	}
	if strings.HasPrefix(s, "@") {
		b, err := os.ReadFile(strings.TrimPrefix(s, "@"))
		if err != nil {
			return nil, err
		}
		s = strings.TrimSpace(strings.TrimPrefix(string(b), "\ufeff"))
		if s == "" {
			return map[string]any{}, nil
		}
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, fmt.Errorf("params must be a JSON object: %w", err)
	}
	return m, nil
}

// resolveFrame finds the single frame registering name, or errors.
func resolveFrame(ctx context.Context, wsURL, name string, timeout time.Duration) (string, error) {
	dctx, cancel := context.WithTimeout(ctx, minDuration(timeout, 2500*time.Millisecond))
	defer cancel()
	c, err := dialCDP(dctx, wsURL)
	if err != nil {
		return "", err
	}
	defer c.Close()
	_ = mustCall(dctx, c, "WebMCP.enable", nil)
	frames := map[string]bool{}
	deadline := time.Now().Add(minDuration(timeout, 2500*time.Millisecond))
	for time.Now().Before(deadline) {
		select {
		case ev := <-c.events:
			if ev.Method != "WebMCP.toolsAdded" && ev.Method != "WebMCP.toolsChanged" {
				continue
			}
			var p struct {
				Tools   []map[string]any `json:"tools"`
				FrameID string            `json:"frameId"`
			}
			if json.Unmarshal(ev.Params, &p) != nil {
				continue
			}
			for _, m := range p.Tools {
				if n, _ := m["name"].(string); n == name {
					fid := p.FrameID
					if v, _ := m["frameId"].(string); v != "" {
						fid = v
					}
					frames[fid] = true
				}
			}
			if len(frames) > 1 {
				return "", fmt.Errorf("tool %q in multiple frames; pass --frame", name)
			}
		case <-time.After(100 * time.Millisecond):
		case <-dctx.Done():
			goto done
		}
	}
done:
	if len(frames) == 1 {
		for fid := range frames {
			return fid, nil
		}
	}
	return "", fmt.Errorf("tool %q not found (run: list)", name)
}

func waitToolResponded(ctx context.Context, c *CDP, invocationID string, timeout time.Duration) (json.RawMessage, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		remain := time.Until(deadline)
		select {
		case ev := <-c.events:
			if ev.Method != "WebMCP.toolResponded" {
				continue
			}
			var p struct {
				InvocationID string          `json:"invocationId"`
				Status       string          `json:"status"`
				Output       json.RawMessage `json:"output"`
				ErrorText    string          `json:"errorText"`
			}
			if json.Unmarshal(ev.Params, &p) != nil || p.InvocationID != invocationID {
				continue
			}
			switch p.Status {
			case "Completed":
				if len(p.Output) == 0 {
					return json.RawMessage(`{"ok":true}`), nil
				}
				return p.Output, nil
			case "Canceled":
				return nil, fmt.Errorf("tool canceled")
			default:
				if p.ErrorText != "" {
					return nil, fmt.Errorf("%s", p.ErrorText)
				}
				return nil, fmt.Errorf("tool failed: %s", p.Status)
			}
		case <-time.After(minDuration(remain, 100*time.Millisecond)):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return nil, fmt.Errorf("timed out waiting for tool response")
}

// invokeWebMCP: exactly {frameId, toolName, input:object} -> {invocationId}
// -> async toolResponded. Retries once as callTool on older builds.
func invokeWebMCP(ctx context.Context, wsURL, name, paramsRaw, frameID string, timeout time.Duration) (json.RawMessage, error) {
	params, err := parseParams(paramsRaw)
	if err != nil {
		return nil, err
	}
	dctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	c, err := dialCDP(dctx, wsURL)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	_ = mustCall(dctx, c, "WebMCP.enable", nil)
	if frameID == "" {
		if frameID, err = resolveFrame(ctx, wsURL, name, timeout); err != nil {
			return nil, err
		}
	}
	call := func(method string) (json.RawMessage, error) {
		mctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return c.Call(mctx, method, map[string]any{"frameId": frameID, "toolName": name, "input": params})
	}
	raw, err := call("WebMCP.invokeTool")
	if err != nil && isNotFound(err) {
		raw, err = call("WebMCP.callTool")
	}
	if err != nil {
		return nil, err
	}
	var got struct {
		InvocationID string `json:"invocationId"`
	}
	if json.Unmarshal(raw, &got) != nil || got.InvocationID == "" {
		return raw, nil // synchronous result
	}
	return waitToolResponded(ctx, c, got.InvocationID, timeout)
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
