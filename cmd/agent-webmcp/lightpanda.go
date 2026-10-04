package main

// Lightpanda engine. Read-only: crawl, observe, search. Never act.
//
// Launch shape mirrors agent-browser's cli/src/native/cdp/lightpanda.rs:
//   lightpanda serve --host 127.0.0.1 --port N --load-resources stylesheet
// Readiness is a poll of /json/version, which Lightpanda does serve, and the
// child is checked for early exit so a crash reports immediately instead of
// hanging until the timeout. stdout/stderr are drained into a bounded ring
// buffer: an unread child pipe fills, and then the child blocks on write.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	lpStartupTimeout = 10 * time.Second
	lpPollInterval   = 100 * time.Millisecond
	lpMaxLogLines    = 40
)

// lpLogBuffer is a bounded ring of recent child output, kept for error text.
type lpLogBuffer struct {
	mu    sync.Mutex
	lines []string
}

func (b *lpLogBuffer) push(line string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.lines) >= lpMaxLogLines {
		b.lines = b.lines[1:]
	}
	b.lines = append(b.lines, line)
}

func (b *lpLogBuffer) snapshot() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]string, len(b.lines))
	copy(out, b.lines)
	return out
}

func (b *lpLogBuffer) tail() string {
	lines := b.snapshot()
	if len(lines) == 0 {
		return ""
	}
	return "\n  " + strings.Join(lines, "\n  ")
}

// lpProcess is a running Lightpanda with one process-level CDP endpoint.
type lpProcess struct {
	cmd     *exec.Cmd
	port    int
	wsURL   string
	logs    *lpLogBuffer
	stopped bool
	mu      sync.Mutex
}

func (p *lpProcess) kill() {
	p.mu.Lock()
	if p.stopped {
		p.mu.Unlock()
		return
	}
	p.stopped = true
	p.mu.Unlock()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
		_, _ = p.cmd.Process.Wait()
	}
}

// findLightpanda resolves the binary: explicit path, then PATH, then the two
// conventional install locations agent-browser also checks.
func findLightpanda(explicit string) (string, error) {
	if explicit != "" {
		if _, err := os.Stat(explicit); err != nil {
			return "", fmt.Errorf("lightpanda binary not found at %s", explicit)
		}
		return explicit, nil
	}
	if p, err := exec.LookPath("lightpanda"); err == nil {
		return p, nil
	}
	home, err := os.UserHomeDir()
	if err == nil {
		for _, c := range []string{
			filepath.Join(home, ".lightpanda", "lightpanda"),
			filepath.Join(home, ".local", "bin", "lightpanda"),
		} {
			if _, err := os.Stat(c); err == nil {
				return c, nil
			}
		}
	}
	return "", fmt.Errorf("lightpanda not found. Install from https://lightpanda.io/docs/open-source/installation or pass --executable-path")
}

func launchLightpanda(ctx context.Context, binPath string) (*lpProcess, error) {
	port, err := freePort()
	if err != nil {
		return nil, fmt.Errorf("could not find a free port for lightpanda: %v", err)
	}

	// stylesheet: makes external CSS contribute to computed styles, which is
	// what visibility checks read. Without it computed style is empty and
	// every element looks hidden.
	args := []string{
		"serve",
		"--host", "127.0.0.1",
		"--port", fmt.Sprint(port),
		"--load-resources", "stylesheet",
		"--load-resources", "iframe",
	}
	cmd := exec.Command(binPath, args...)
	cmd.Stdin = nil
	logs := &lpLogBuffer{}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to launch lightpanda at %s: %v", binPath, err)
	}

	// Drain both pipes or the child blocks once the OS buffer fills.
	var wg sync.WaitGroup
	drain := func(rc interface{ Read([]byte) (int, error) }) {
		defer wg.Done()
		buf := make([]byte, 4096)
		var acc strings.Builder
		for {
			n, err := rc.Read(buf)
			if n > 0 {
				acc.Write(buf[:n])
				for {
					line := acc.String()
					i := strings.IndexByte(line, '\n')
					if i < 0 {
						break
					}
					logs.push(strings.TrimSpace(line[:i]))
					acc.Reset()
					acc.WriteString(line[i+1:])
				}
			}
			if err != nil {
				if s := strings.TrimSpace(acc.String()); s != "" {
					logs.push(s)
				}
				return
			}
		}
	}
	wg.Add(2)
	go drain(stdout)
	go drain(stderr)

	p := &lpProcess{cmd: cmd, port: port, logs: logs}

	// Readiness: poll /json/version, but check for early exit first so a
	// crashed process reports its own error instead of timing out.
	deadline := time.Now().Add(lpStartupTimeout)
	var lastErr error
	for {
		if p.cmd.ProcessState != nil && p.cmd.ProcessState.Exited() {
			p.kill()
			return nil, fmt.Errorf("lightpanda exited before CDP became ready (status %v)%s", p.cmd.ProcessState, logs.tail())
		}
		var v map[string]any
		if err := cdpGet(port, "/json/version", &v); err == nil {
			ws, _ := v["webSocketDebuggerUrl"].(string)
			if ws == "" {
				lastErr = fmt.Errorf("/json/version returned no webSocketDebuggerUrl")
			} else {
				p.wsURL = ws
				break
			}
		} else {
			lastErr = err
		}
		if time.Now().After(deadline) {
			p.kill()
			return nil, fmt.Errorf("timed out after %s waiting for lightpanda CDP on port %d (last probe: %v)%s", lpStartupTimeout, port, lastErr, logs.tail())
		}
		time.Sleep(lpPollInterval)
	}
	_ = ctx
	return p, nil
}

// lpInteractive mirrors the fields of LP.getInteractiveElements that this CLI
// needs. Verified against live pages: name can be null, type is "native" for
// ordinary controls.
type lpInteractive struct {
	BackendNodeID int    `json:"backendNodeId"`
	TagName       string `json:"tagName"`
	Role          string `json:"role"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	Href          string `json:"href"`
	TabIndex      int    `json:"tabIndex"`
}

type lpInteractiveResult struct {
	Elements []lpInteractive `json:"elements"`
}

type lpMarkdownResult struct {
	Markdown string `json:"markdown"`
}

// lpSnapshot builds a snapshot from Lightpanda's LP domain instead of the
// injected observeJS. One call replaces the whole in-page walk.
//
// Caveat carried into every consumer: geometry is approximate on Lightpanda,
// so Node holds a backendNodeId, not a window.__jevFast id. Nothing that
// re-resolves through that window cache may run against this snapshot. The
// run loop re-resolves through LP.getNodeDetails instead (lploop.go).
func lpSnapshot(ctx context.Context, p *lpProcess, target string, timeout time.Duration) (*snapshot, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := dialCDP(cctx, p.wsURL)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	tgt, err := conn.Call(cctx, "Target.createTarget", map[string]any{"url": "about:blank"})
	if err != nil {
		return nil, err
	}
	var created struct {
		TargetID string `json:"targetId"`
	}
	if err := json.Unmarshal(tgt, &created); err != nil || created.TargetID == "" {
		return nil, fmt.Errorf("lightpanda: no target id from createTarget")
	}
	att, err := conn.Call(cctx, "Target.attachToTarget", map[string]any{"targetId": created.TargetID, "flatten": true})
	if err != nil {
		return nil, err
	}
	var attached struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(att, &attached); err != nil || attached.SessionID == "" {
		return nil, fmt.Errorf("lightpanda: no session id from attachToTarget")
	}
	sid := attached.SessionID

	// All page work happens in the attached session.
	page := func(method string, params map[string]any) (json.RawMessage, error) {
		return lpCall(ctx, conn, p, method, params, sid, timeout)
	}

	var snapURL, snapTitle string

	// The target was created blank so the session exists before any page code
	// runs. Navigate it now and wait for load, otherwise the LP domain reports
	// an empty document.
	if target != "" && target != "about:blank" {
		if _, err := page("Page.navigate", map[string]any{"url": target}); err != nil {
			return nil, fmt.Errorf("lightpanda: navigate %s: %v", target, err)
		}
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			if r, err := page("Runtime.evaluate", map[string]any{
				"expression": "document.readyState", "returnByValue": true,
			}); err == nil {
				var rs struct {
					Result struct {
						Value string `json:"value"`
					} `json:"result"`
				}
				if json.Unmarshal(r, &rs) == nil && rs.Result.Value == "complete" {
					break
				}
			}
			time.Sleep(150 * time.Millisecond)
		}
	}

	// The LP domain payloads carry no URL or title. Read both through the
	// attached session, before it goes away.
	if v, err := page("Runtime.evaluate", map[string]any{"expression": "location.href", "returnByValue": true}); err == nil {
		snapURL = lpValueString(v)
	}
	if v, err := page("Runtime.evaluate", map[string]any{"expression": "document.title", "returnByValue": true}); err == nil {
		snapTitle = lpValueString(v)
	}

	els, err := page("LP.getInteractiveElements", map[string]any{})
	if err != nil {
		return nil, fmt.Errorf("lightpanda: LP.getInteractiveElements: %v", err)
	}
	md, err := page("LP.getMarkdown", map[string]any{})
	if err != nil {
		// Markdown is a nice-to-have; the element list is the snapshot.
		md = nil
	}

	var ir lpInteractiveResult
	if err := json.Unmarshal(els, &ir); err != nil {
		return nil, fmt.Errorf("lightpanda: cannot parse getInteractiveElements: %v", err)
	}
	text := ""
	if md != nil {
		var mr lpMarkdownResult
		if json.Unmarshal(md, &mr) == nil {
			text = mr.Markdown
		}
	}

	return lpBuildSnapshot(snapURL, snapTitle, text, ir), nil
}

// lpBuildSnapshot turns a getInteractiveElements result into a snapshot. It is
// the one place the element-to-action mapping lives, so observe, crawl and the
// run loop cannot drift apart on what an element means.
//
// Two differences from observeJS are deliberate. A <select> is one action
// carrying the whole dropdown, because Lightpanda reports elements and not
// their options; the value comes from --params. There are no scroll actions,
// because there is no layout to scroll.
func lpBuildSnapshot(pageURL, title, text string, ir lpInteractiveResult) *snapshot {
	snap := &snapshot{URL: pageURL, Title: title, Text: text, Guards: map[string][]any{}}
	for _, e := range ir.Elements {
		label := e.Name
		if label == "" {
			label = e.Href
		}
		snap.Actions = append(snap.Actions, snapAction{
			ID:    fmt.Sprintf("lp%d", e.BackendNodeID),
			Kind:  lpKind(e),
			Node:  e.BackendNodeID,
			Role:  e.Role,
			Label: label,
			Href:  e.Href,
		})
		// The guard names the element, never its value: an act is allowed to
		// change the value without tripping its own freshness check.
		snap.Guards[fmt.Sprintf("%d", e.BackendNodeID)] = []any{e.TagName, e.Role, e.Href}
	}
	snap.Actions = append(snap.Actions,
		snapAction{ID: "wait", Kind: "wait", Label: "Wait for the page to update"})
	return snap
}

// lpKind maps one interactive element onto the same operation vocabulary
// observeJS uses, so the judge sees one set of operations on either engine.
func lpKind(e lpInteractive) string {
	switch strings.ToLower(e.TagName) {
	case "select":
		return "select"
	case "textarea":
		return "fill"
	case "a", "button":
		return "click"
	case "input":
		switch strings.ToLower(e.Type) {
		case "submit", "button", "image", "reset", "checkbox", "radio":
			return "click"
		default:
			return "fill"
		}
	default:
		return "click"
	}
}

// lpCall issues a CDP command on an attached Lightpanda session. dialCDP's
// Call has no sessionId parameter, and Lightpanda requires the session, so the
// frame is written directly.
func lpCall(ctx context.Context, conn *CDP, p *lpProcess, method string, params map[string]any, sessionID string, timeout time.Duration) (json.RawMessage, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	id := conn.next.Add(1)
	ch := make(chan rpcReply, 1)
	conn.pending.Store(id, ch)
	defer conn.pending.Delete(id)
	body, _ := json.Marshal(map[string]any{
		"id": id, "method": method, "params": params, "sessionId": sessionID,
	})
	if err := conn.conn.Write(cctx, websocket.MessageText, body); err != nil {
		return nil, err
	}
	select {
	case reply := <-ch:
		if reply.Error != nil {
			return nil, fmt.Errorf("cdp %s: %s", method, reply.Error.Message)
		}
		return reply.Result, nil
	case <-cctx.Done():
		return nil, cctx.Err()
	}
}
// captureSnapshotLP is the Lightpanda path for one observation. The process is
// launched, used, and killed inside the call: Lightpanda starts instantly, so
// there is nothing to keep warm across CLI invocations, and a fresh process
// cannot leak state from a previous run.
func captureSnapshotLP(ctx context.Context, binPath, target string, timeout time.Duration) (*snapshot, string, error) {
	bin, err := findLightpanda(binPath)
	if err != nil {
		return nil, "", err
	}
	proc, err := launchLightpanda(ctx, bin)
	if err != nil {
		return nil, "", err
	}
	defer proc.kill()

	snap, err := lpSnapshot(ctx, proc, target, timeout)
	if err != nil {
		return nil, "", err
	}
	if snap.URL == "" {
		if u, err := lpPageURL(ctx, proc, timeout); err == nil {
			snap.URL = u
		}
	}
	return snap, fingerprintSnap(snap), nil
}

// lpEvalString runs one expression in the page and returns it as a string.
// The LP domain payloads carry no URL or title, so both are read back.
func lpEvalString(ctx context.Context, p *lpProcess, expr string, timeout time.Duration) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	conn, err := dialCDP(cctx, p.wsURL)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	res, err := conn.Call(cctx, "Runtime.evaluate", map[string]any{"expression": expr, "returnByValue": true})
	if err != nil {
		return "", err
	}
	var out struct {
		Result struct {
			Value string `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(res, &out); err != nil {
		return "", err
	}
	return out.Result.Value, nil
}

// lpPageURL reads location.href for the snapshot URL.
func lpPageURL(ctx context.Context, p *lpProcess, timeout time.Duration) (string, error) {
	return lpEvalString(ctx, p, "location.href", timeout)
}

// lpJSONValue returns the raw JSON of an evaluate result, whatever its type.
// lpValueString is the string case and cannot read a list or an object.
func lpJSONValue(res json.RawMessage) (json.RawMessage, error) {
	var out struct {
		Result struct {
			Value json.RawMessage `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(res, &out); err != nil {
		return nil, err
	}
	if len(out.Result.Value) == 0 {
		return nil, fmt.Errorf("lightpanda: evaluate returned no value")
	}
	return out.Result.Value, nil
}

// lpPageTitle reads document.title for the snapshot title.
// lpValueString pulls a string out of a Runtime.evaluate reply.
func lpValueString(res json.RawMessage) string {
	var out struct {
		Result struct {
			Value string `json:"value"`
		} `json:"result"`
	}
	if json.Unmarshal(res, &out) != nil {
		return ""
	}
	return out.Result.Value
}
