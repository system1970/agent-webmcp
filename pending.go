package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Detached invocations. Our CDP sessions are per-connection: WebMCP.toolResponded
// is only delivered on the connection that called invokeTool. So --detach keeps
// the connection alive in a detached waiter process that writes the terminal
// result into the session's pending/ dir; `result` and `cancel` talk to the
// waiter through marker files (no daemon, no sockets).
//
//	pending/<id>.pending  written when the invocation starts (id known)
//	pending/<id>.json     terminal result {invocationId,status,output,errorText}
//	pending/<id>.cancel   cancel request, consumed by the waiter

type PendingResult struct {
	InvocationID string          `json:"invocationId"`
	Status       string          `json:"status"`
	Output       json.RawMessage `json:"output,omitempty"`
	ErrorText    string          `json:"errorText,omitempty"`
	CompletedAt  int64           `json:"completedAt"`
}

func pendingDir(session string) string {
	return filepath.Join(sessionDir(session), "pending")
}

func pendingPaths(session, id string) (marker, result, cancel string) {
	d := pendingDir(session)
	return filepath.Join(d, id+".pending"), filepath.Join(d, id+".json"), filepath.Join(d, id+".cancel")
}

func writeJSON(path string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// runWaiter is the __waiter child-process body: start the invocation, publish
// the id, then hold the connection until a terminal toolResponded (or cancel /
// timeout / connection loss) and record the result.
func runWaiter(session, tool, paramsPath, frameID string, timeout time.Duration) error {
	pending := pendingDir(session)
	startErrPath := filepath.Join(pending, fmt.Sprintf("_start-%d.json", time.Now().UnixNano()))
	failStart := func(err error) error {
		_ = writeJSON(startErrPath, map[string]string{"status": "StartError", "errorText": err.Error()})
		return err
	}

	params, err := os.ReadFile(paramsPath)
	if err != nil {
		return failStart(err)
	}
	port, err := readPort(session)
	if err != nil {
		return failStart(err)
	}
	t, err := pickPageTarget(port)
	if err != nil {
		return failStart(err)
	}
	ctx, cancelAll := context.WithTimeout(context.Background(), timeout+30*time.Second)
	defer cancelAll()
	c, err := dialCDP(ctx, t.WebSocketDebuggerURL)
	if err != nil {
		return failStart(err)
	}
	defer c.Close()
	enableWebMCP(ctx, c)

	id, err := startInvoke(ctx, c, tool, string(params), frameID)
	if err != nil {
		return failStart(err)
	}

	marker, result, cancelFile := pendingPaths(session, id)
	if err := writeJSON(marker, map[string]any{"invocationId": id, "tool": tool}); err != nil {
		return failStart(err)
	}

	deadline := time.Now().Add(timeout)
	cancelSent := false
	var terminal *PendingResult
	for terminal == nil {
		if !cancelSent {
			if _, err := os.Stat(cancelFile); err == nil {
				cancelSent = true
				cctx, cc := context.WithTimeout(ctx, 5*time.Second)
				_, _ = c.Call(cctx, "WebMCP.cancelInvocation", map[string]any{"invocationId": id})
				cc()
			}
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
			if err := json.Unmarshal(ev.Params, &p); err != nil || p.InvocationID != id {
				continue
			}
			terminal = &PendingResult{InvocationID: id, Status: p.Status, Output: p.Output, ErrorText: p.ErrorText, CompletedAt: time.Now().Unix()}
		case <-c.done:
			terminal = &PendingResult{InvocationID: id, Status: "Error", ErrorText: "browser connection closed before tool responded", CompletedAt: time.Now().Unix()}
		case <-time.After(150 * time.Millisecond):
			if cancelSent && time.Now().After(deadline.Add(5*time.Second)) {
				terminal = &PendingResult{InvocationID: id, Status: "Canceled", ErrorText: "cancel sent; no toolResponded confirmation", CompletedAt: time.Now().Unix()}
			} else if time.Now().After(deadline) {
				terminal = &PendingResult{InvocationID: id, Status: "Timeout", ErrorText: "waiter timeout exceeded", CompletedAt: time.Now().Unix()}
			}
		case <-ctx.Done():
			terminal = &PendingResult{InvocationID: id, Status: "Timeout", ErrorText: "hard context timeout", CompletedAt: time.Now().Unix()}
		}
	}
	_ = writeJSON(result, terminal)
	_ = os.Remove(marker)
	_ = os.Remove(paramsPath)
	return nil
}

// spawnWaiter starts the detached waiter and returns the invocationId once the
// child has published it (or a start error).
func spawnWaiter(session, tool, paramsText, frameID string, timeout time.Duration) (string, error) {
	pending := pendingDir(session)
	if err := os.MkdirAll(pending, 0o755); err != nil {
		return "", err
	}
	nano := time.Now().UnixNano()
	paramsPath := filepath.Join(pending, fmt.Sprintf("_params-%d.json", nano))
	startErrPath := filepath.Join(pending, fmt.Sprintf("_start-%d.json", nano))
	if err := os.WriteFile(paramsPath, []byte(paramsText), 0o644); err != nil {
		return "", err
	}
	before := map[string]bool{}
	ents, _ := os.ReadDir(pending)
	for _, e := range ents {
		if strings.HasSuffix(e.Name(), ".pending") {
			before[e.Name()] = true
		}
	}

	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	args := []string{"__waiter", tool,
		"--session", session,
		"--params-file", paramsPath,
		"--timeout-ms", itoa(int(timeout.Milliseconds())),
		"--start-err", startErrPath,
	}
	if frameID != "" {
		args = append(args, "--frame", frameID)
	}
	cmd := exec.Command(exe, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	setupChild(cmd)
	if err := cmd.Start(); err != nil {
		return "", err
	}
	go func() { _ = cmd.Wait() }()

	dead := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(startErrPath); err == nil {
			b, _ := os.ReadFile(startErrPath)
			var pe struct {
				ErrorText string `json:"errorText"`
			}
			_ = json.Unmarshal(b, &pe)
			_ = os.Remove(startErrPath)
			_ = os.Remove(paramsPath)
			return "", errors.New("detach failed to start: " + pe.ErrorText)
		}
		ents, _ := os.ReadDir(pending)
		for _, e := range ents {
			n := e.Name()
			if strings.HasSuffix(n, ".pending") && !before[n] {
				return strings.TrimSuffix(n, ".pending"), nil
			}
		}
		if time.Now().After(dead) {
			return "", errors.New("detach waiter did not report an invocationId in time")
		}
		time.Sleep(40 * time.Millisecond)
	}
}

// readPendingResult waits up to wait for pending/<id>.json.
func readPendingResult(session, id string, wait time.Duration) (*PendingResult, error) {
	marker, result, _ := pendingPaths(session, id)
	if _, err := os.Stat(result); err != nil {
		if _, err2 := os.Stat(marker); err2 != nil {
			return nil, errors.New("unknown invocation '" + id + "' (no pending marker or result; waiter may have died)")
		}
	}
	dead := time.Now().Add(wait)
	for {
		if b, err := os.ReadFile(result); err == nil {
			var pr PendingResult
			if err := json.Unmarshal(b, &pr); err != nil {
				return nil, err
			}
			return &pr, nil
		}
		if time.Now().After(dead) {
			if _, err := os.Stat(marker); err == nil {
				return nil, errors.New("invocation still running (waiter has not reported a terminal result)")
			}
			return nil, errors.New("unknown invocation '" + id + "' (no result appeared)")
		}
		time.Sleep(120 * time.Millisecond)
	}
}

func requestCancel(session, id string, wait time.Duration) (*PendingResult, error) {
	marker, result, cancelFile := pendingPaths(session, id)
	if _, err := os.Stat(marker); err != nil {
		if _, err2 := os.Stat(result); err2 == nil {
			return readPendingResult(session, id, 0) // already terminal
		}
		return nil, errors.New("no active waiter for invocation '" + id + "'")
	}
	if err := os.WriteFile(cancelFile, []byte("cancel"), 0o644); err != nil {
		return nil, err
	}
	return readPendingResult(session, id, wait)
}

// cleanupStalePending removes pending artifacts older than an hour (crashed
// waiters, abandoned results).
func cleanupStalePending(session string) {
	d := pendingDir(session)
	ents, err := os.ReadDir(d)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-time.Hour)
	for _, e := range ents {
		info, err := e.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		_ = os.Remove(filepath.Join(d, e.Name()))
	}
}
