package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Shared profile context. One profile = one browser = one cookie jar,
// many tabs. Sessions bind to tabs; they never own a browser process.
// Default profile "shared" (login once, every session reuses it);
// --profile NAME (or AGENT_WEBMCP_PROFILE) opts out to an isolated
// browser+profile, e.g. for untrusted pages. This mirrors the industry
// shape (TinyFish Browser Context Profiles): persistent state per
// account/environment, ephemeral sessions attach it, handoff/vault
// repairs it when stale.

// sessionProfile is set once in run() from --profile / env. Deep
// functions (captureSnapshot, actExecute, decideOnce) read it: the CLI
// is single-threaded, one profile per invocation.
var sessionProfile = "shared"

func resolveProfile(g *globals) string {
	if g.profile != "" {
		return sanitizeSession(g.profile)
	}
	if v := os.Getenv("AGENT_WEBMCP_PROFILE"); v != "" {
		return sanitizeSession(v)
	}
	return "shared"
}

func profileBase(p string) string {
	return filepath.Join(filepath.Dir(sessionRoot()), "profiles", sanitizeSession(p))
}

func browserPortFile(p string) string   { return filepath.Join(profileBase(p), "browser-port") }
func browserPidFile(p string) string    { return filepath.Join(profileBase(p), "browser.pid") }
func browserHeadedFile(p string) string { return filepath.Join(profileBase(p), "headed") }
func browserProfileDir(p string) string { return filepath.Join(profileBase(p), "profile") }

func profilePort(p string) (int, error) {
	b, err := os.ReadFile(browserPortFile(p))
	if err != nil {
		return 0, err
	}
	return parsePort(string(b))
}

func parsePort(s string) (int, error) {
	n, err := parseInt(strings.TrimSpace(s))
	if err != nil || n <= 0 {
		return 0, errBadPort
	}
	return n, nil
}

func profileHeaded(p string) bool {
	b, err := os.ReadFile(browserHeadedFile(p))
	return err == nil && strings.TrimSpace(string(b)) == "1"
}

func writeHeaded(p string, headed bool) {
	v := "0"
	if headed {
		v = "1"
	}
	_ = os.MkdirAll(profileBase(p), 0o755)
	_ = os.WriteFile(browserHeadedFile(p), []byte(v), 0o644)
}

// ensureProfileBrowser reuses the profile's live browser or launches one.
// Headed is a launch property: callers handle mismatch explicitly.
func ensureProfileBrowser(p, chromeBin string, headed bool, timeout time.Duration) (port int, reused bool, err error) {
	if port, err := profilePort(p); err == nil {
		var v map[string]any
		if err := cdpGet(port, "/json/version", &v); err == nil {
			return port, true, nil
		}
	}
	if chromeBin == "" {
		if chromeBin, err = findChrome(""); err != nil {
			return 0, false, err
		}
	} else if chromeBin, err = findChrome(chromeBin); err != nil {
		return 0, false, err
	}
	if port, err = freePort(); err != nil {
		return 0, false, err
	}
	if err := os.MkdirAll(browserProfileDir(p), 0o755); err != nil {
		return 0, false, err
	}
	log, err := os.OpenFile(filepath.Join(profileBase(p), "chrome.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return 0, false, err
	}
	defer log.Close()
	cmd := exec.Command(chromeBin, chromeArgs(port, browserProfileDir(p), headed)...)
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		return 0, false, fmt.Errorf("chrome launch failed: %w", err)
	}
	go cmd.Wait()
	_ = os.MkdirAll(profileBase(p), 0o755)
	_ = os.WriteFile(browserPortFile(p), []byte(fmt.Sprintf("%d", port)), 0o644)
	_ = os.WriteFile(browserPidFile(p), []byte(fmt.Sprintf("%d", cmd.Process.Pid)), 0o644)
	writeHeaded(p, headed)
	if err := waitCDP(port, timeout); err != nil {
		return 0, false, err
	}
	return port, false, nil
}

// killProfileBrowser stops the profile's browser. Tabs die; the profile
// (cookies, logins) persists for the next launch.
func killProfileBrowser(p string) {
	if b, err := os.ReadFile(browserPidFile(p)); err == nil {
		if pid, err := parseInt(strings.TrimSpace(string(b))); err == nil && pid > 0 {
			if proc, err := os.FindProcess(pid); err == nil {
				_ = proc.Kill()
			}
		}
	}
	_ = os.Remove(browserPortFile(p))
	_ = os.Remove(browserPidFile(p))
	_ = os.Remove(browserHeadedFile(p))
}

// Session↔tab binding. The target file records profile + target id so
// sessions resolve across profiles.

// targetFile records "profile\ntargetID".
func targetFile(session string) string {
	return filepath.Join(sessionDir(session), "target")
}

func writeTargetID(session, profile, id string) error {
	if err := os.MkdirAll(sessionDir(session), 0o755); err != nil {
		return err
	}
	return os.WriteFile(targetFile(session), []byte(profile+"\n"+id), 0o644)
}

func readTargetBinding(session string) (profile, id string, err error) {
	b, err := os.ReadFile(targetFile(session))
	if err != nil {
		return "", "", err
	}
	parts := strings.SplitN(strings.TrimSpace(string(b)), "\n", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("bad target binding for session %s (run: open <url> --session %s)", session, session)
	}
	return parts[0], parts[1], nil
}

// sessionTarget resolves a session to its live tab. Errors are phrased
// as remedies: no binding, dead browser, or closed tab.
func sessionTarget(session string, timeout time.Duration) (Target, error) {
	_ = timeout
	profile, tid, err := readTargetBinding(session)
	if err != nil {
		return Target{}, fmt.Errorf("no_tab: session %s has no bound tab (run: open <url> --session %s)", session, session)
	}
	port, err := profilePort(profile)
	if err != nil {
		return Target{}, fmt.Errorf("no_browser: profile %s has no live browser (run: open <url> --session %s)", profile, session)
	}
	targets, err := listTargets(port)
	if err != nil {
		return Target{}, fmt.Errorf("browser_dead: profile %s browser unreachable (run: open <url> --session %s to relaunch)", profile, session)
	}
	for _, t := range targets {
		if t.ID == tid && t.Type == "page" && t.WebSocketDebuggerURL != "" {
			return t, nil
		}
	}
	return Target{}, fmt.Errorf("tab_gone: session %s tab was closed (run: open <url> --session %s)", session, session)
}

func sessionWS(session string, timeout time.Duration) (string, error) {
	t, err := sessionTarget(session, timeout)
	if err != nil {
		return "", err
	}
	return t.WebSocketDebuggerURL, nil
}

func sessionURL(session string, timeout time.Duration) (string, error) {
	t, err := sessionTarget(session, timeout)
	if err != nil {
		return "", err
	}
	return t.URL, nil
}

// bindSessionTab ensures the profile browser and binds the session to a
// live tab: the bound tab when alive, else a fresh tab (optionally at url).
func bindSessionTab(ctx context.Context, session, rawURL, chromeBin string, headed bool, timeout time.Duration) (Target, bool, error) {
	_ = ctx
	port, _, err := ensureProfileBrowser(sessionProfile, chromeBin, headed, timeout)
	if err != nil {
		return Target{}, false, err
	}
	if _, tid, terr := readTargetBinding(session); terr == nil {
		if targets, lerr := listTargets(port); lerr == nil {
			for _, t := range targets {
				if t.ID == tid && t.Type == "page" && t.WebSocketDebuggerURL != "" {
					return t, false, nil
				}
			}
		}
	}
	newURL := rawURL
	if newURL == "" {
		newURL = "about:blank"
	}
	var t Target
	if err := cdpPut(port, "/json/new?"+url.QueryEscape(newURL), &t); err != nil || t.WebSocketDebuggerURL == "" {
		return Target{}, false, fmt.Errorf("open_failed: new tab rejected (%v)", err)
	}
	if err := writeTargetID(session, sessionProfile, t.ID); err != nil {
		return Target{}, false, err
	}
	// Fresh binds sweep leftover blank startup tabs so tab count tracks
	// session count (the launcher opens about:blank; binds replace it).
	if targets, lerr := listTargets(port); lerr == nil {
		for _, x := range targets {
			if x.Type == "page" && x.ID != t.ID && (x.URL == "about:blank" || x.URL == "chrome://newtab/") {
				_ = closeTarget(port, x.ID)
			}
		}
	}
	return t, true, nil
}

// closeSessionTab closes the session's tab and drops the binding.
// Evidence (decisions.jsonl, snapshots) stays. Legacy per-session
// browsers (pre-shared-profile) are killed when their pid file remains.
func closeSessionTab(session string) error {
	if profile, tid, err := readTargetBinding(session); err == nil {
		if port, perr := profilePort(profile); perr == nil {
			_ = closeTarget(port, tid)
		}
	}
	_ = os.Remove(targetFile(session))
	if pid, err := readPid(session); err == nil && pid > 0 {
		if proc, err := os.FindProcess(pid); err == nil {
			_ = proc.Kill()
		}
		_ = os.Remove(filepath.Join(sessionDir(session), "cdp-port"))
		_ = os.Remove(filepath.Join(sessionDir(session), "chrome.pid"))
	}
	return nil
}

func closeTarget(port int, id string) error {
	resp, err := httpClient.Get(fmt.Sprintf("http://127.0.0.1:%d/json/close/%s", port, id))
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// killAllProfileBrowsers stops every profile browser. Tabs die everywhere;
// profiles persist.
func killAllProfileBrowsers() {
	base := filepath.Dir(sessionRoot())
	ents, err := os.ReadDir(filepath.Join(base, "profiles"))
	if err != nil {
		return
	}
	for _, e := range ents {
		if e.IsDir() {
			killProfileBrowser(e.Name())
		}
	}
}
