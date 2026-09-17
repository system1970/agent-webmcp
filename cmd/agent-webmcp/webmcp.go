package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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
	// Overlay marks tools registered by agent-webmcp custom packs rather
	// than the site itself. Set by the CLI from the session's overlay
	// record — never trusted from page content.
	Overlay     *bool          `json:"overlay,omitempty"`
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

// ---- per-session frame cache ----
// invoke without --frame otherwise pays a full toolsAdded drain (seconds)
// on every call. The cache maps tool name -> frameId and is best-effort:
// a stale entry fails fast on invoke and falls back to re-resolve.

func frameCachePath(session string) string {
	return filepath.Join(sessionDir(session), "framecache.json")
}

func frameCacheLoad(session string) map[string]string {
	b, err := os.ReadFile(frameCachePath(session))
	if err != nil {
		return map[string]string{}
	}
	var m map[string]string
	if json.Unmarshal(b, &m) != nil || m == nil {
		return map[string]string{}
	}
	return m
}

func frameCacheSave(session string, m map[string]string) {
	if len(m) > 200 {
		// bound growth: keep arbitrary 200 entries
		n := 0
		for k := range m {
			if n >= 200 {
				delete(m, k)
			}
			n++
		}
	}
	b, _ := json.Marshal(m)
	_ = os.MkdirAll(sessionDir(session), 0o755)
	_ = os.WriteFile(frameCachePath(session), b, 0o644)
}

func frameCacheGet(session, tool string) (string, bool) {
	if session == "" || tool == "" {
		return "", false
	}
	f, ok := frameCacheLoad(session)[tool]
	return f, ok && f != ""
}

func frameCacheSet(session, tool, frameID string) {
	if session == "" || tool == "" || frameID == "" {
		return
	}
	m := frameCacheLoad(session)
	m[tool] = frameID
	frameCacheSave(session, m)
}

func frameCacheInvalidate(session, tool string) {
	if session == "" || tool == "" {
		return
	}
	m := frameCacheLoad(session)
	if _, ok := m[tool]; !ok {
		return
	}
	delete(m, tool)
	frameCacheSave(session, m)
}

// frameCacheSaveAll records every tool->frame pair from a fresh list.
func frameCacheSaveAll(session string, tools []WebMCPTool) {
	if session == "" || len(tools) == 0 {
		return
	}
	m := frameCacheLoad(session)
	for _, t := range tools {
		if t.Name != "" && t.FrameID != "" {
			m[t.Name] = t.FrameID
		}
	}
	frameCacheSave(session, m)
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
	// Fast path: return 200ms after the last arrival instead of the full window.
	// Empty pages pay the full dead window, so keep it tight (1s): late SPA
	// registrations are recovered via re-list, per troubleshooting docs.
	dead := time.Now().Add(1000 * time.Millisecond)
	quiet := 200 * time.Millisecond
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
// If frameID is empty it is resolved from the page's tool list, consulting
// the per-session frame cache first (fast path: zero extra round-trips).
func invokeWebMCP(ctx context.Context, wsURL, name, inputJSON, frameID string, timeout time.Duration) (json.RawMessage, error) {
	return invokeWebMCPSession(ctx, wsURL, "", name, inputJSON, frameID, timeout)
}

func invokeWebMCPSession(ctx context.Context, wsURL, session, name, inputJSON, frameID string, timeout time.Duration) (json.RawMessage, error) {
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

	// Resolve frameId when omitted: session cache first, then fast
	// listTools RPC, then event drain. The cache makes repeat invokes
	// zero-extra-round-trip; a stale entry fails fast below and retries.
	cachedFrame := ""
	if frameID == "" && session != "" {
		if f, ok := frameCacheGet(session, name); ok {
			cachedFrame = f
			frameID = f
		}
	}
	if frameID == "" {
		frameID, err = resolveFrame(ctx, c, name)
		if err != nil {
			return nil, err
		}
		if session != "" {
			frameCacheSet(session, name, frameID)
		}
	}

	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	invokeOnce := func(fid string) (json.RawMessage, error) {
		raw, err := c.Call(callCtx, "WebMCP.invokeTool", map[string]any{
			"frameId":  fid,
			"toolName": name,
			"input":    inputObj,
		})
		if err != nil && isNotFound(err) {
			// Older/alternate builds used callTool; retry once with that name.
			raw2, err2 := c.Call(callCtx, "WebMCP.callTool", map[string]any{
				"frameId":  fid,
				"toolName": name,
				"input":    inputObj,
			})
			if err2 != nil {
				return nil, err2
			}
			return raw2, nil
		}
		return raw, err
	}
	raw, err := invokeOnce(frameID)
	if err != nil && cachedFrame != "" && isNotFound(err) {
		// Stale cache entry (navigation re-registered tools under a new
		// frame): drop it, re-resolve fresh, retry once.
		frameCacheInvalidate(session, name)
		if fresh, rerr := resolveFrame(ctx, c, name); rerr == nil {
			frameID = fresh
			frameCacheSet(session, name, fresh)
			raw, err = invokeOnce(frameID)
		}
	}
	if err != nil {
		return nil, err
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

// resolveFrame finds the frameId for a tool name: fast listTools RPC first,
// toolsAdded event drain as fallback (older Chrome without listTools).
func resolveFrame(ctx context.Context, c *CDP, name string) (string, error) {
	if fid, amb, found := resolveFrameFast(ctx, c, name); found {
		if amb {
			return "", errors.New("tool '" + name + "' registered in multiple frames; pass --frame <frame-id> (see: agent-webmcp list)")
		}
		return fid, nil
	}
	dead := time.Now().Add(1500 * time.Millisecond)
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
					return "", errors.New("tool '" + name + "' registered in multiple frames; pass --frame <frame-id> (see: agent-webmcp list)")
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
	return "", errors.New("tool '" + name + "' not found (run: agent-webmcp list)")
}

// resolveFrameFast tries a single listTools RPC (Chrome 152+). Returns
// (frameID, ambiguous, found). No events consumed on miss.
func resolveFrameFast(ctx context.Context, c *CDP, name string) (string, bool, bool) {
	fctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	raw, err := c.Call(fctx, "WebMCP.listTools", map[string]any{})
	if err != nil {
		return "", false, false
	}
	var matches []string
	for _, t := range parseToolList(raw) {
		if t.Name == name && t.FrameID != "" {
			matches = append(matches, t.FrameID)
		}
	}
	switch len(matches) {
	case 0:
		return "", false, false
	case 1:
		return matches[0], false, true
	default:
		return "", true, true
	}
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
