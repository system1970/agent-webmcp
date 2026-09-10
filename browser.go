package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type OpenResult struct {
	Session  string         `json:"session"`
	URL      string         `json:"url"`
	Port     int            `json:"port"`
	Headless bool           `json:"headless"`
	WebMCP   map[string]any `json:"webmcp"`
	Tools    []WebMCPTool   `json:"tools,omitempty"`
}

// ensureChrome returns a live CDP port for the session, launching Chrome if needed.
func ensureChrome(session, chromeBin string, headed bool, timeout time.Duration) (int, bool, error) {
	if port, err := readPort(session); err == nil {
		if err := cdpGet(port, "/json/version", &map[string]any{}); err == nil {
			return port, false, nil
		}
	}
	bin := findChrome(chromeBin)
	if bin == "" {
		return 0, false, errors.New("chrome not found (use --chrome or set AGENT_WEBMCP_CHROME)")
	}
	port, err := freePort()
	if err != nil {
		return 0, false, err
	}
	prof := profileDir(session)
	if err := os.MkdirAll(prof, 0o755); err != nil {
		return 0, false, err
	}
	args := chromeArgs(port, prof, headed, true)
	cmd := exec.Command(bin, args...)
	// Detach: survive CLI exit. Suppress output to log file for debuggability.
	logPath := filepath.Join(sessionDir(session), "chrome.log")
	lf, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if lf != nil {
		cmd.Stdout = lf
		cmd.Stderr = lf
	}
	setupChild(cmd)
	if err := cmd.Start(); err != nil {
		return 0, false, err
	}
	_ = writePort(session, port)
	_ = writePid(session, cmd.Process.Pid)
	// Best-effort: don't Wait(); let it outlive us. Reap via goroutine only if it exits fast.
	go func() { _ = cmd.Wait() }()
	if err := waitCDP(port, timeout); err != nil {
		return 0, false, err
	}
	return port, true, nil
}

func activateTarget(port int, id string) {
	_ = cdpPut(port, "/json/activate/"+id)
}

func navigateAndWait(ctx context.Context, wsURL, url string, loadTimeout time.Duration) error {
	c, err := dialCDP(ctx, wsURL)
	if err != nil {
		return err
	}
	defer c.Close()
	nctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_, _ = c.Call(nctx, "Page.enable", map[string]any{})
	_, err = c.Call(nctx, "Page.navigate", map[string]any{"url": url})
	if err != nil {
		return err
	}
	if loadTimeout <= 0 {
		return nil
	}
	dead := time.Now().Add(loadTimeout)
	for {
		rem := time.Until(dead)
		if rem <= 0 {
			return nil // soft timeout: page may still be loading (SPA); don't fail open
		}
		select {
		case ev := <-c.events:
			if ev.Method == "Page.loadEventFired" {
				return nil
			}
		case <-time.After(rem):
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func openURL(ctx context.Context, session, url, chromeBin string, headed bool, timeout time.Duration) (*OpenResult, error) {
	port, _, err := ensureChrome(session, chromeBin, headed, 15*time.Second)
	if err != nil {
		return nil, err
	}
	// Reuse active page or create one.
	t, err := pickPageTarget(port)
	if err != nil {
		t, err = newPageTarget(port, "")
		if err != nil {
			return nil, err
		}
	}
	activateTarget(port, t.ID)
	finalURL := t.URL
	if url != "" {
		if err := navigateAndWait(ctx, t.WebSocketDebuggerURL, url, 8*time.Second); err != nil {
			return nil, err
		}
		finalURL = url
		// Re-resolve target URL (navigation may swap WS? usually stable).
		time.Sleep(300 * time.Millisecond)
		if ts, err := listTargets(port); err == nil {
			for _, x := range ts {
				if x.ID == t.ID {
					finalURL = x.URL
					if x.WebSocketDebuggerURL != "" {
						t.WebSocketDebuggerURL = x.WebSocketDebuggerURL
					}
					break
				}
			}
		}
	}
	// WebMCP discovery (best-effort, fast).
	lctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tools, _, _ := listWebMCP(lctx, t.WebSocketDebuggerURL)
	webmcp := map[string]any{"experimental": true, "available": len(tools) > 0, "toolCount": len(tools)}
	return &OpenResult{Session: session, URL: finalURL, Port: port, Headless: !headed, WebMCP: webmcp, Tools: tools}, nil
}

func closeSession(session string) error {
	port, err := readPort(session)
	pid := readPid(session)
	if err != nil && pid == 0 {
		return errors.New("no active session '" + session + "'")
	}
	if pid > 0 {
		if p, err := os.FindProcess(pid); err == nil {
			_ = p.Kill()
		}
		killByPort(port)
	}
	_ = os.Remove(filepath.Join(sessionDir(session), "cdp-port"))
	_ = os.Remove(filepath.Join(sessionDir(session), "chrome.pid"))
	// Keep profile/ for persistence across restarts.
	return nil
}

// killByPort is a fallback: ask CDP to close the browser.
func killByPort(port int) {
	if port <= 0 {
		return
	}
	var ts []Target
	if err := cdpGet(port, "/json/list", &ts); err != nil {
		return
	}
	// Find browser WS via /json/version.
	var v struct {
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := cdpGet(port, "/json/version", &v); err != nil || v.WebSocketDebuggerURL == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = cdpCall(ctx, v.WebSocketDebuggerURL, "Browser.close", map[string]any{})
}

func prettyToolsJSON(tools []WebMCPTool) string {
	b, _ := json.Marshal(tools)
	return string(b)
}
