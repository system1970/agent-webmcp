package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAcceptTerminal(t *testing.T) {
	cases := []struct {
		name string
		d    *decision
		want bool
	}{
		{"nil refuses", nil, false},
		{"done at threshold", &decision{Operation: "DONE", Confidence: 0.2, GoalComplete: 0.7}, true},
		{"done above threshold", &decision{Operation: "DONE", Confidence: 0.9, GoalComplete: 0.95}, true},
		{"done below noul threshold but choice head clears", &decision{Operation: "DONE", Confidence: 0.9, GoalComplete: 0.69}, true},
		{"done judges its own head not the op head", &decision{Operation: "DONE", Confidence: 0.35, GoalComplete: 0.9}, true},
		{"done accepted on explicit choice head alone", &decision{Operation: "DONE", Confidence: 0.95, GoalComplete: 0.2}, true},
		{"done refused with neither head at threshold", &decision{Operation: "DONE", Confidence: 0.4, GoalComplete: 0.5}, false},
		{"blocked at threshold", &decision{Operation: "BLOCKED", Confidence: 0.7}, true},
		{"blocked shrug refuses", &decision{Operation: "BLOCKED", Confidence: 0.2}, false},
		{"non-terminal never", &decision{Operation: "CLICK", Confidence: 0.99}, false},
	}
	for _, c := range cases {
		if got := acceptTerminal(c.d); got != c.want {
			t.Errorf("%s: acceptTerminal = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestDetectLoginWall(t *testing.T) {
	cases := []struct {
		name string
		url  string
		text string
		want bool
	}{
		{"signin url decisive", "https://x.com/users/sign_in", "welcome", true},
		{"login path decisive", "https://x.com/login", "welcome", true},
		{"oauth authorize decisive", "https://x.com/oauth/authorize?x=1", "welcome", true},
		{"full gate", "https://x.com/session", "Forgot password? Create an account. Sign in with Google", true},
		{"nav link is not a wall", "https://www.tinystartups.com/", "Log in / Sign up Launch now Discover", false},
		{"submit wizard is not a wall", "https://www.tinystartups.com/submit", "STEP 1 OF 5 Your startup's URL Continue", false},
		{"single marker is not a wall", "https://x.com/pricing", "create an account to continue", false},
	}
	for _, c := range cases {
		if got := detectLoginWall(c.url, c.text); got != c.want {
			t.Errorf("%s: detectLoginWall = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestOpsForKindScroll(t *testing.T) {
	if got := opsForKind("scroll"); got != "SCROLL" {
		t.Errorf("opsForKind(scroll) = %q, want SCROLL", got)
	}
	if got := opsForKind("wait"); got != "" {
		t.Errorf("opsForKind(wait) = %q, want empty (synthetic WAIT op covers it)", got)
	}
}

func TestJudgmentKinds(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_WEBMCP_HOME", dir)
	d := &decision{Operation: "CLICK", Target: "a1", Confidence: 0.9}
	saveDecision("s1", d, &snapshot{URL: "https://x.com/"}, nil, "goal", "")
	appendExecuted("s1", "", map[string]any{"operation": "CLICK", "target": "a1"})
	b, err := os.ReadFile(filepath.Join(dir, "sessions", "s1", "decisions.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]bool{}
	for _, ln := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var m map[string]any
		if err := json.Unmarshal([]byte(ln), &m); err != nil {
			t.Fatal(err)
		}
		k, _ := m["kind"].(string)
		if k == "" {
			t.Errorf("record without kind: %s", ln)
		}
		kinds[k] = true
	}
	if !kinds["decision"] || !kinds["executed"] {
		t.Errorf("want both decision and executed kinds, got %v", kinds)
	}
	// Consumers filter by top-level operation, as decideOnce does when
	// building recent_actions: decision records carry no top-level op.
	kept := 0
	for _, ln := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var m map[string]any
		_ = json.Unmarshal([]byte(ln), &m)
		if op, _ := m["operation"].(string); op != "" {
			kept++
		}
	}
	if kept != 1 {
		t.Errorf("operation-bearing records = %d, want 1 executed", kept)
	}
}

func TestBuildStateRedacted(t *testing.T) {
	snap := &snapshot{
		URL: "https://x.com/login", Title: "Login", Text: "Sign in",
		Actions: []snapAction{
			{ID: "e1", Kind: "fill", Role: "textbox", Label: "Password", Value: "s3cret-pw"},
			{ID: "e2", Kind: "click", Role: "button", Label: "Sign in"},
		},
	}
	history := []map[string]any{
		{"operation": "CLICK", "target": "e0", "text": "user@email.com", "page_changed": true, "confidence": 0.9},
	}
	b, _ := json.Marshal(buildState("goal", snap, nil, history, nil))
	var st map[string]any
	if err := json.Unmarshal(b, &st); err != nil {
		t.Fatal(err)
	}
	for _, e := range st["elements"].([]any) {
		em := e.(map[string]any)
		if _, ok := em["value"]; ok {
			t.Errorf("element value leaked into Jev state: %v", e)
		}
		filled, _ := em["filled"].(bool)
		wantFilled := em["index"] == "e1"
		if filled != wantFilled {
			t.Errorf("element %v filled=%v, want %v (presence without content)", em["index"], filled, wantFilled)
		}
	}
	for _, r := range st["recent_actions"].([]any) {
		if _, ok := r.(map[string]any)["text"]; ok {
			t.Errorf("agent text leaked into Jev state: %v", r)
		}
	}
	s := string(b)
	if strings.Contains(s, "s3cret-pw") || strings.Contains(s, "user@email.com") {
		t.Errorf("secret material present in serialized state")
	}
}

func TestHistoryRunScoping(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_WEBMCP_HOME", dir)
	d := &decision{Operation: "CLICK", Target: "a1", Confidence: 0.9}
	saveDecision("s1", d, &snapshot{URL: "https://x.com/"}, nil, "goal", "run-A")
	appendExecuted("s1", "run-A", map[string]any{"operation": "CLICK", "target": "a1"})
	saveDecision("s1", d, &snapshot{URL: "https://x.com/"}, nil, "goal", "run-B")
	appendExecuted("s1", "run-B", map[string]any{"operation": "CLICK", "target": "a1"})
	if h := readHistory("s1", 10, "run-B"); len(h) != 2 {
		t.Errorf("run-scoped history = %d records, want 2 from run-B only", len(h))
	} else {
		for _, m := range h {
			if r, _ := m["run"].(string); r != "run-B" {
				t.Errorf("run-A record leaked into run-B history: %v", m["kind"])
			}
		}
	}
	if h := readHistory("s1", 10, ""); len(h) != 4 {
		t.Errorf("unscoped history = %d records, want all 4", len(h))
	}
}

func TestAuthStampRoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AGENT_WEBMCP_HOME", dir)
	saveAuthStamp(authStamp{Host: "example.com", State: "anonymous", CheckedAt: stampNow(), Session: "s1", Method: "probe"})
	b, err := os.ReadFile(authStatePath("example.com"))
	if err != nil {
		t.Fatal(err)
	}
	var s authStamp
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatal(err)
	}
	if s.Host != "example.com" || s.State != "anonymous" || s.CheckedAt == "" {
		t.Errorf("stamp mismatch: %+v", s)
	}
}
