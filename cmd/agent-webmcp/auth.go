package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// auth: the login-wall tier. Indexing never needs auth (gates are
// visible anonymously); acting does. Two verbs, one contract:
//
//	probe   — read-only: what gate, if any, does this session's
//	          current page show? Always exits 0 with a state stamp.
//	handoff — pause, not failure: relaunch the session browser headed
//	          on the login page, notify the human, block until the
//	          wall is gone (or timeout). The human types the password;
//	          secrets never enter model context, Jev state, or logs.
//
// Auth state is machine-local (auth/<host>.json under the CLI home);
// cards record only the gate kind + login_url, never session state.

// detectLoginWall reports sign-in pages where further action burns
// steps for nothing. Same shape as detectBotWall: URL markers are
// decisive; text markers require a challenged look, not a passing
// nav link ("Log in / Sign up" in a header is not a wall).
func detectLoginWall(url, text string) bool {
	u := strings.ToLower(url)
	for _, m := range []string{
		"/login", "/signin", "/sign-in", "/sign_in",
		"/auth/", "/auth?", "/users/sign_in", "/account/login",
		"/session/new", "/oauth/authorize",
		"accounts.google.com", "appleid.apple.com",
	} {
		if strings.Contains(u, m) {
			return true
		}
	}
	t := strings.ToLower(text)
	hits := 0
	for _, m := range []string{
		"forgot password", "create an account", "don't have an account",
		"no account yet", "sign in with", "log in with",
		"continue with email", "enter your password",
	} {
		if strings.Contains(t, m) {
			hits++
		}
	}
	return hits >= 2
}

func authRoot() string {
	if v := os.Getenv("AGENT_WEBMCP_HOME"); v != "" {
		return filepath.Join(v, "auth")
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return filepath.Join(h, ".agent-webmcp", "auth")
	}
	return ".agent-webmcp-auth"
}

type authStamp struct {
	Host      string `json:"host"`
	State     string `json:"state"` // logged_in | anonymous | unknown | no_session | unreachable
	CheckedAt string `json:"checked_at"`
	Session   string `json:"session"`
	Method    string `json:"method,omitempty"`
	Marker    string `json:"marker,omitempty"`
}

func authStatePath(host string) string {
	return filepath.Join(authRoot(), sanitizeSession(host)+".json")
}

func saveAuthStamp(s authStamp) {
	_ = os.MkdirAll(authRoot(), 0o755)
	b, _ := json.Marshal(s)
	_ = os.WriteFile(authStatePath(s.Host), b, 0o644)
}

func stampNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// currentPageURL best-efforts the session's live page URL for remedies.
// Empty when the session is dead — the caller phrases around that.
func currentPageURL(session string) string {
	port, err := readPort(session)
	if err != nil {
		return ""
	}
	t, err := pickPageTarget(port)
	if err != nil {
		return ""
	}
	return t.URL
}

func notifySend(title, body string) {
	if _, err := exec.LookPath("notify-send"); err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = exec.CommandContext(ctx, "notify-send", "-a", "agent-webmcp", title, body).Run()
}

// finishAuthRequired ends a run paused at a login wall. Exit 2, a typed
// pause with a human remedy — never exit 0 (nothing succeeded) and never
// exit 1 (nothing failed).
func finishAuthRequired(g *globals, goal string, steps int, pageURL string) int {
	host := hostOfURL(pageURL)
	remedy := "open the login page, then: auth handoff --session " + g.session + " --url <login-url>"
	if pageURL != "" {
		remedy = "auth handoff --session " + g.session + " --url " + pageURL
	}
	data := map[string]any{
		"goal": goal, "steps": steps, "host": host,
		"url": pageURL, "session": g.session, "remedy": remedy,
	}
	if g.json {
		fmt.Printf("%s\n", mustJSON(map[string]any{
			"ok": false, "code": "auth_required",
			"error": "login wall — one-time human handoff needed, then re-run the goal",
			"data":  data,
		}))
		return 2
	}
	fmt.Fprintf(os.Stderr, "auth required for %s — run: agent-webmcp %s\n", host, remedy)
	return 2
}

func authCmd(ctx context.Context, g *globals, rest []string) int {
	if len(rest) == 0 {
		return fail("usage", "usage: agent-webmcp auth <probe|handoff> [--session NAME] [--json]")
	}
	switch rest[0] {
	case "probe":
		return authProbeCmd(ctx, g, rest[1:])
	case "handoff", "login":
		return authHandoffCmd(ctx, g, rest[1:])
	default:
		return fail("usage", "usage: agent-webmcp auth <probe|handoff> [--session NAME] [--json]")
	}
}

// authProbeCmd senses the gate on the session's current page. Read-only,
// always an answer (never an error): the scheduler needs states, not
// failures.
func authProbeCmd(ctx context.Context, g *globals, rest []string) int {
	marker, _ := verbFlag(rest, "marker")
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	report := func(s authStamp, extra map[string]any) int {
		out := map[string]any{
			"host": s.Host, "state": s.State, "checked_at": s.CheckedAt,
			"session": s.Session, "url": extra["url"],
			"login_wall": extra["login_wall"], "marker_present": extra["marker_present"],
		}
		if s.Marker != "" {
			out["marker"] = s.Marker
		}
		if g.json {
			ok(out)
			return 0
		}
		fmt.Printf("auth %s: host=%s wall=%v state=%s\n", s.Session, s.Host, out["login_wall"], s.State)
		return 0
	}
	if _, err := readPort(g.session); err != nil {
		return report(authStamp{Host: "", State: "no_session", CheckedAt: stampNow(), Session: g.session},
			map[string]any{"url": "", "login_wall": false, "marker_present": false})
	}
	snap, _, err := captureSnapshot(ctx, g.session, timeout)
	if err != nil {
		return report(authStamp{Host: "", State: "unreachable", CheckedAt: stampNow(), Session: g.session},
			map[string]any{"url": currentPageURL(g.session), "login_wall": false, "marker_present": false})
	}
	host := hostOfURL(snap.URL)
	wall := detectLoginWall(snap.URL, snap.Text)
	markerHit := marker != "" && strings.Contains(snap.Text, marker)
	state := "unknown"
	if wall {
		state = "anonymous"
	} else if markerHit {
		state = "logged_in"
	}
	st := authStamp{Host: host, State: state, CheckedAt: stampNow(), Session: g.session, Method: "probe", Marker: marker}
	saveAuthStamp(st)
	return report(st, map[string]any{"url": snap.URL, "login_wall": wall, "marker_present": markerHit})
}

// authHandoffCmd relaunches the session browser headed on the login page
// and blocks until a human completes the login. One handoff per host per
// profile: cookies persist in profile/, so every later run probes clean.
// Tabs are not preserved across the relaunch; the profile (logins) is.
func authHandoffCmd(ctx context.Context, g *globals, rest []string) int {
	url, _ := verbFlag(rest, "url")
	if url == "" {
		for _, a := range rest {
			if !strings.HasPrefix(a, "-") {
				url = a
				break
			}
		}
	}
	if url == "" {
		return fail("usage", "usage: agent-webmcp auth handoff --url <login-url> [--session NAME] [--wait SEC] [--marker TEXT] [--reason TEXT]")
	}
	if !strings.Contains(url, "://") {
		url = "https://" + url
	}
	waitSecs := 300
	if v, ok := verbFlag(rest, "wait"); ok {
		if n, err := parseInt(v); err == nil {
			waitSecs = n
		}
	}
	if waitSecs < 30 {
		waitSecs = 30
	}
	if waitSecs > 1800 {
		waitSecs = 1800
	}
	marker, _ := verbFlag(rest, "marker")
	reason, _ := verbFlag(rest, "reason")
	timeout := time.Duration(g.timeoutMs) * time.Millisecond

	// Headed is a launch property, not a tab property: a headless live
	// browser stays headless. Relaunch on the same profile so stored
	// logins survive; the human gets a visible window.
	_ = closeSession(g.session)
	r, err := openURL(ctx, g.session, url, g.chrome, true, 30*time.Second)
	if err != nil {
		return failErr("handoff_failed", err)
	}
	host := hostOfURL(r.URL)
	after := "log in"
	if reason != "" {
		after = reason
	}
	prompt := fmt.Sprintf("login needed: %s — window open at %s. Log in yourself to allow: %s. Waiting up to %ds.", host, r.URL, after, waitSecs)
	if marker != "" {
		prompt = fmt.Sprintf("login needed: %s — window open at %s. Log in yourself to allow: %s (then %q appears). Waiting up to %ds.", host, r.URL, after, marker, waitSecs)
	}
	notifySend("agent-webmcp: login needed", host+" — log in in the opened window")
	fmt.Fprintln(os.Stderr, prompt)

	deadline := time.Now().Add(time.Duration(waitSecs) * time.Second)
	for {
		snap, _, serr := captureSnapshot(ctx, g.session, timeout)
		if serr != nil {
			return fail("auth_cancelled", "browser session ended during handoff — re-run auth handoff")
		}
		markerOK := marker == "" || strings.Contains(snap.Text, marker)
		if !detectLoginWall(snap.URL, snap.Text) && markerOK {
			st := authStamp{Host: hostOfURL(snap.URL), State: "logged_in", CheckedAt: stampNow(), Session: g.session, Method: "handoff", Marker: marker}
			saveAuthStamp(st)
			if g.json {
				ok(map[string]any{"host": st.Host, "url": snap.URL, "session": g.session, "state": "logged_in", "checked_at": st.CheckedAt})
				return 0
			}
			fmt.Printf("auth ok: %s logged in (session %s)\n", st.Host, g.session)
			return 0
		}
		if time.Now().After(deadline) {
			return fail("auth_timeout", fmt.Sprintf("no login observed on %s within %ds — re-run auth handoff", host, waitSecs))
		}
		select {
		case <-ctx.Done():
			return fail("auth_cancelled", "handoff cancelled")
		case <-time.After(2 * time.Second):
		}
	}
}
