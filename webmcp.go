package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// WebMCPTool is the normalized page-tool descriptor.
type WebMCPTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"inputSchema,omitempty"`
	FrameID     string         `json:"frameId,omitempty"`
	Origin      string         `json:"origin,omitempty"`
	ReadOnly    *bool          `json:"readOnly,omitempty"`
	Untrusted   *bool          `json:"untrustedContent,omitempty"`
	// Pack names the CLI pack that registered this tool, when it is not the
	// site's own. Set by the CLI from the session's pack record — never
	// trusted from page content.
	Pack        string         `json:"pack,omitempty"`
	Extra       map[string]any `json:"extra,omitempty"`
}

func boolPtr(b bool) *bool { return &b }

// enableWebMCP best-effort enables the domain (absent on old builds).
func enableWebMCP(ctx context.Context, c *CDP) {
	ctx2, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_, _ = c.Call(ctx2, "WebMCP.enable", map[string]any{})
}

type rawTool struct {
	Name               string         `json:"name"`
	Description        string         `json:"description"`
	Title              string         `json:"title"`
	InputSchema        any            `json:"inputSchema"`
	FrameID            string         `json:"frameId"`
	Origin             string         `json:"origin"`
	URL                string         `json:"url"`
	ReadOnly           *bool          `json:"readOnly"`
	ReadOnlyHint       *bool          `json:"readOnlyHint"`
	UntrustedContent   *bool          `json:"untrustedContent"`
	UntrustedContHint  *bool          `json:"untrustedContentHint"`
	Annotations        map[string]any `json:"annotations"`
	Extra              map[string]any `json:"-"`
}

func normalizeTool(rt rawTool) WebMCPTool {
	t := WebMCPTool{Name: rt.Name, Description: rt.Description, FrameID: rt.FrameID, Origin: rt.Origin}
	if t.Description == "" && rt.Title != "" {
		t.Description = rt.Title
	}
	switch s := rt.InputSchema.(type) {
	case map[string]any:
		t.InputSchema = s
	case string:
		var m map[string]any
		if s != "" {
			_ = json.Unmarshal([]byte(s), &m)
		}
		t.InputSchema = m
	}
	if rt.ReadOnly != nil {
		t.ReadOnly = rt.ReadOnly
	} else if rt.ReadOnlyHint != nil {
		t.ReadOnly = rt.ReadOnlyHint
	}
	if rt.UntrustedContent != nil {
		t.Untrusted = rt.UntrustedContent
	} else if rt.UntrustedContHint != nil {
		t.Untrusted = rt.UntrustedContHint
	}
	if rt.Annotations != nil {
		t.Extra = rt.Annotations
	}
	return t
}

// listWebMCP dials the page target, enables the domain, and lists tools.
// Handles both `listTools` and older `getTools`-style builds via error fallback.
func listWebMCP(ctx context.Context, wsURL string) ([]WebMCPTool, string, error) {
	c, err := dialCDP(ctx, wsURL)
	if err != nil {
		return nil, "", err
	}
	defer c.Close()
	enableWebMCP(ctx, c)

	callCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	// Primary: WebMCP.listTools
	if raw, err := c.Call(callCtx, "WebMCP.listTools", map[string]any{}); err == nil {
		return parseToolList(raw), "", nil
	} else if !isNotFound(err) {
		// Protocol error other than missing method: surface it unless it's clearly
		// "no tools" — check message.
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "not found") || strings.Contains(msg, "no such") || strings.Contains(msg, "unsupported") {
			return nil, "webmcp_unsupported", err
		}
		// Fall through to drain events; some builds only push toolsAdded.
	}

	// Fallback (Chrome 149-152 has no listTools): drain toolsAdded events.
	// Fast path: return 300ms after the last arrival instead of the full window.
	dead := time.Now().Add(1500 * time.Millisecond)
	quiet := 300 * time.Millisecond
	seen := map[string]WebMCPTool{}
	lastHit := time.Now()
	for {
		rem := time.Until(dead)
		if rem <= 0 {
			break
		}
		wait := rem
		if len(seen) > 0 {
			if q := time.Until(lastHit.Add(quiet)); q < wait {
				wait = q
				if wait <= 0 {
					break
				}
			}
		}
		select {
		case ev := <-c.events:
			if ev.Method == "WebMCP.toolsAdded" || ev.Method == "WebMCP.toolsChanged" {
				for _, t := range parseToolList(ev.Params) {
					seen[t.Name+"\x00"+t.FrameID] = t
				}
				lastHit = time.Now()
			} else if ev.Method == "WebMCP.toolsRemoved" {
				var rm struct {
					Tools []struct {
						Name    string `json:"name"`
						FrameID string `json:"frameId"`
					} `json:"tools"`
				}
				if json.Unmarshal(ev.Params, &rm) == nil {
					for _, r := range rm.Tools {
						delete(seen, r.Name+"\x00"+r.FrameID)
					}
				}
			}
		case <-time.After(wait):
			if len(seen) > 0 {
				rem = 0
			}
		case <-ctx.Done():
			rem = 0
		}
	}
	out := make([]WebMCPTool, 0, len(seen))
	for _, t := range seen {
		out = append(out, t)
	}
	return out, "", nil
}

func parseToolList(raw json.RawMessage) []WebMCPTool {
	if len(raw) == 0 {
		return nil
	}
	// Shapes: {tools:[...]} | [...] | {result:{tools:[...]}}
	var wrap struct {
		Tools []rawTool `json:"tools"`
	}
	if err := json.Unmarshal(raw, &wrap); err == nil && len(wrap.Tools) > 0 {
		return mapTools(wrap.Tools)
	}
	var arr []rawTool
	if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
		return mapTools(arr)
	}
	// tools may nest inputSchema as JSON string; already handled.
	return nil
}

func mapTools(in []rawTool) []WebMCPTool {
	out := make([]WebMCPTool, 0, len(in))
	for _, r := range in {
		if r.Name == "" {
			continue
		}
		out = append(out, normalizeTool(r))
	}
	return out
}

func isNotFound(err error) bool {
	if err == nil {
		return false
	}
	m := strings.ToLower(err.Error())
	return strings.Contains(m, "wasn't found") || strings.Contains(m, "was not found") ||
		strings.Contains(m, "not found") || strings.Contains(m, "no such") ||
		strings.Contains(m, "unsupported") || strings.Contains(m, "invalid method") ||
		strings.Contains(m, "method not found")
}

// invokeWebMCP calls a page tool (Chrome 152 protocol).
// invokeTool requires {frameId, toolName, input:object} and returns
// {invocationId}; the result arrives async via WebMCP.toolResponded.
// If frameID is empty it is resolved from the page's tool list.
func invokeWebMCP(ctx context.Context, wsURL, name, inputJSON, frameID string, timeout time.Duration) (json.RawMessage, error) {
	c, err := dialCDP(ctx, wsURL)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	enableWebMCP(ctx, c)

	if inputJSON == "" {
		inputJSON = "{}"
	}
	inputJSON = strings.TrimSpace(strings.TrimPrefix(inputJSON, "\ufeff"))
	var inputObj map[string]any
	if err := json.Unmarshal([]byte(inputJSON), &inputObj); err != nil {
		return nil, errors.New("params must be a JSON object: " + err.Error())
	}
	if inputObj == nil {
		inputObj = map[string]any{}
	}

	// Resolve frameId when omitted.
	if frameID == "" {
		frameID, err = resolveFrame(ctx, c, name)
		if err != nil {
			return nil, err
		}
	}

	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	raw, err := c.Call(callCtx, "WebMCP.invokeTool", map[string]any{
		"frameId":  frameID,
		"toolName": name,
		"input":    inputObj,
	})
	if err != nil {
		// Older/alternate builds used callTool; retry once with that name.
		if isNotFound(err) {
			raw2, err2 := c.Call(callCtx, "WebMCP.callTool", map[string]any{
				"frameId":  frameID,
				"toolName": name,
				"input":    inputObj,
			})
			if err2 != nil {
				return nil, err2
			}
			raw = raw2
		} else {
			return nil, err
		}
	}
	var inv struct {
		InvocationID string `json:"invocationId"`
	}
	if err := json.Unmarshal(raw, &inv); err != nil || inv.InvocationID == "" {
		// Some builds return the result synchronously.
		if len(raw) > 0 {
			return raw, nil
		}
		return nil, errors.New("invoke returned no invocationId")
	}
	return waitToolResponded(ctx, c, inv.InvocationID, timeout)
}

// resolveFrame finds the frameId for a tool name via toolsAdded events.
func resolveFrame(ctx context.Context, c *CDP, name string) (string, error) {
	dead := time.Now().Add(2500 * time.Millisecond)
	var matches []string
	for {
		rem := time.Until(dead)
		if rem <= 0 {
			break
		}
		select {
		case ev := <-c.events:
			if ev.Method == "WebMCP.toolsAdded" || ev.Method == "WebMCP.toolsChanged" {
				for _, t := range parseToolList(ev.Params) {
					if t.Name == name && t.FrameID != "" {
						matches = append(matches, t.FrameID)
					}
				}
				if len(matches) == 1 {
					return matches[0], nil
				}
				if len(matches) > 1 {
					return "", errors.New("tool '" + name + "' registered in multiple frames; pass --frame <frame-id> (see: orkestrate list)")
				}
			}
		case <-time.After(rem):
			rem = 0
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	if len(matches) == 1 {
		return matches[0], nil
	}
	return "", errors.New("tool '" + name + "' not found (run: orkestrate list)")
}

func waitToolResponded(ctx context.Context, c *CDP, invocationID string, timeout time.Duration) (json.RawMessage, error) {
	dead := time.Now().Add(timeout)
	for {
		rem := time.Until(dead)
		if rem <= 0 {
			return nil, errors.New("timed out waiting for tool response")
		}
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
			if err := json.Unmarshal(ev.Params, &p); err != nil {
				continue
			}
			if p.InvocationID != invocationID {
				continue
			}
			switch p.Status {
			case "Completed":
				if len(p.Output) == 0 {
					return json.RawMessage(`{"ok":true}`), nil
				}
				return p.Output, nil
			case "Canceled":
				return nil, errors.New("tool invocation canceled")
			default:
				if p.ErrorText != "" {
					return nil, errors.New(p.ErrorText)
				}
				return nil, errors.New("tool invocation failed: " + p.Status)
			}
		case <-time.After(rem):
			return nil, errors.New("timed out waiting for tool response")
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}
