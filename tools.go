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

// Custom tools: plain JS files stored per host, auto-loaded on open.
// Layout: ~/.agent-webmcp/tools/<name>.js + <name>.json {hosts:[...]}.
// A pack is an async IIFE that registers tools via the page's own
// document.modelContext and returns a short report string.

type packMeta struct {
	Name  string   `json:"name"`
	Hosts []string `json:"hosts"`
	File  string   `json:"file"`
	Added string   `json:"added"`
}

func toolsRoot() string {
	if v := os.Getenv("AGENT_WEBMCP_HOME"); v != "" {
		return filepath.Join(v, "tools")
	}
	h, err := os.UserHomeDir()
	if err != nil || h == "" {
		return ".agent-webmcp-tools"
	}
	return filepath.Join(h, ".agent-webmcp", "tools")
}

func packName(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	s := strings.Trim(b.String(), "-_")
	if s == "" {
		return "pack"
	}
	return s
}

func toolsAdd(path, name string, hosts []string) (string, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if len(strings.TrimSpace(string(src))) == 0 {
		return "", errors.New("empty tool file")
	}
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	name = packName(name)
	if len(hosts) == 0 {
		hosts = []string{"*"}
	}
	for i, h := range hosts {
		hosts[i] = normalizeHost(h)
	}
	if err := os.MkdirAll(toolsRoot(), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(toolsRoot(), name+".js"), src, 0o644); err != nil {
		return "", err
	}
	meta, _ := json.MarshalIndent(packMeta{
		Name: name, Hosts: hosts, File: name + ".js",
		Added: time.Now().UTC().Format(time.RFC3339),
	}, "", "  ")
	if err := os.WriteFile(filepath.Join(toolsRoot(), name+".json"), meta, 0o644); err != nil {
		return "", err
	}
	return name, nil
}

func normalizeHost(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	h = strings.TrimPrefix(h, "https://")
	h = strings.TrimPrefix(h, "http://")
	h = strings.TrimSuffix(h, "/")
	if i := strings.IndexByte(h, '/'); i >= 0 {
		h = h[:i]
	}
	if h == "" {
		return "*"
	}
	return h
}

func stripWWW(h string) string { return strings.TrimPrefix(strings.ToLower(h), "www.") }

func toolsList() ([]packMeta, error) {
	ents, err := os.ReadDir(toolsRoot())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []packMeta
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(toolsRoot(), e.Name()))
		if err != nil {
			continue
		}
		var m packMeta
		if json.Unmarshal(b, &m) != nil || m.Name == "" {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}

func toolsRemove(name string) error {
	name = packName(name)
	_ = os.Remove(filepath.Join(toolsRoot(), name+".js"))
	if err := os.Remove(filepath.Join(toolsRoot(), name+".json")); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func toolsForHost(host string) []packMeta {
	all, err := toolsList()
	if err != nil {
		return nil
	}
	host = stripWWW(host)
	var out []packMeta
	for _, m := range all {
		for _, h := range m.Hosts {
			if h == "*" || stripWWW(h) == host {
				out = append(out, m)
				break
			}
		}
	}
	return out
}

func hostOfURL(u string) string {
	u = strings.ToLower(strings.TrimSpace(u))
	u = strings.TrimPrefix(u, "https://")
	u = strings.TrimPrefix(u, "http://")
	if i := strings.IndexByte(u, '/'); i >= 0 {
		u = u[:i]
	}
	if i := strings.IndexByte(u, ':'); i >= 0 {
		u = u[:i]
	}
	return stripWWW(u)
}

// evalScript runs JS in the page and awaits a by-value result.
func evalScript(ctx context.Context, wsURL, script string, timeout time.Duration) (string, error) {
	c, err := dialCDP(ctx, wsURL)
	if err != nil {
		return "", err
	}
	defer c.Close()
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	raw, err := c.Call(callCtx, "Runtime.evaluate", map[string]any{
		"expression": script, "returnByValue": true, "awaitPromise": true,
	})
	if err != nil {
		return "", err
	}
	var ev struct {
		Result struct {
			Type  string `json:"type"`
			Value any    `json:"value"`
		} `json:"result"`
		ExceptionDetails any `json:"exceptionDetails,omitempty"`
	}
	if err := json.Unmarshal(raw, &ev); err != nil {
		return "", err
	}
	if ev.ExceptionDetails != nil {
		b, _ := json.Marshal(ev.ExceptionDetails)
		return "", errors.New("js exception: " + string(b))
	}
	switch v := ev.Result.Value.(type) {
	case string:
		return v, nil
	case nil:
		return "", nil
	default:
		b, _ := json.Marshal(v)
		return string(b), nil
	}
}

// loadPacks evals stored packs for host on the page. Best-effort: collects
// "name: report" lines, never fails the caller.
func loadPacks(ctx context.Context, wsURL, host string) []string {
	var done []string
	for _, m := range toolsForHost(host) {
		b, err := os.ReadFile(filepath.Join(toolsRoot(), m.File))
		if err != nil {
			done = append(done, m.Name+": read failed: "+err.Error())
			continue
		}
		rep, err := evalScript(ctx, wsURL, string(b), 15*time.Second)
		if err != nil {
			done = append(done, m.Name+": inject failed: "+err.Error())
			continue
		}
		done = append(done, m.Name+": "+strings.TrimSpace(rep))
	}
	return done
}
