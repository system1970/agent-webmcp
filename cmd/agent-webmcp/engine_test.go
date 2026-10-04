package main

import (
	"fmt"
	"strings"
	"testing"
)

func TestParseEngine(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want Engine
		bad  bool
	}{
		{"", EngineChrome, false},
		{"chrome", EngineChrome, false},
		{"chromium", EngineChrome, false},
		{"CHROME", EngineChrome, false},
		{" lightpanda ", EngineLightpanda, false},
		{"lp", EngineLightpanda, false},
		{"firefox", "", true},
	} {
		got, err := parseEngine(tc.in)
		if tc.bad {
			if err == nil {
				t.Errorf("parseEngine(%q) = %q, want error", tc.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseEngine(%q) error: %v", tc.in, err)
		}
		if got != tc.want {
			t.Errorf("parseEngine(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// Lightpanda must refuse the split verbs and everything that needs a real
// renderer. run is deliberately absent: it works there, because it holds one
// CDP connection for the whole loop (lploop.go).
func TestEngineGates(t *testing.T) {
	lp := EngineLightpanda
	if err := requireChrome(lp, FeatureSplitVerbs); err == nil {
		t.Error("decide/act/tick must be refused on lightpanda")
	}
	if err := requireChrome(lp, FeatureWebMCP); err == nil {
		t.Error("WebMCP must be refused on lightpanda")
	}
	if err := requireChrome(lp, FeatureHeaded); err == nil {
		t.Error("headed must be refused on lightpanda")
	}
	if err := requireChrome(lp, FeatureProfiles); err == nil {
		t.Error("profiles must be refused on lightpanda")
	}
	if err := requireChrome(lp, FeatureLayout); err == nil {
		t.Error("geometry must be refused on lightpanda")
	}
	if err := requireChrome(lp, FeatureLoginFlow); err == nil {
		t.Error("login flow must be refused on lightpanda")
	}
	// The refusal must name the remedy, not just the block.
	err := requireChrome(lp, FeatureSplitVerbs)
	if err == nil || !strings.Contains(err.Error(), "use run") {
		t.Errorf("split-verb refusal must point at run, got %v", err)
	}
	ch := EngineChrome
	for _, f := range []Feature{FeatureSplitVerbs, FeatureWebMCP, FeatureHeaded, FeatureProfiles, FeatureLayout, FeatureLoginFlow} {
		if err := requireChrome(ch, f); err != nil {
			t.Errorf("chrome must allow %s, got %v", f, err)
		}
	}
}

// The refusal text is part of the contract: an agent that hits it must learn
// what to run instead.
func TestEngineRefusalNamesRemedy(t *testing.T) {
	for feat, want := range map[Feature]string{
		FeatureSplitVerbs: "run",
		FeatureWebMCP:     "lightpanda",
		FeatureHeaded:     "headless",
	} {
		msg := requireChrome(EngineLightpanda, feat).Error()
		if !strings.Contains(msg, want) {
			t.Errorf("%s refusal %q must mention %q", feat, msg, want)
		}
	}
}

// The element mapping must agree with the vocabulary observeJS uses, because
// one judge reads both engines' snapshots.
func TestLPKindVocabulary(t *testing.T) {
	cases := []struct {
		tag, typ, want string
	}{
		{"a", "", "click"},
		{"button", "", "click"},
		{"input", "submit", "click"},
		{"input", "button", "click"},
		{"input", "checkbox", "click"},
		{"input", "radio", "click"},
		{"input", "text", "fill"},
		{"input", "email", "fill"},
		{"input", "search", "fill"},
		{"input", "password", "fill"},
		{"textarea", "", "fill"},
		{"select", "", "select"},
		{"div", "", "click"},
	}
	for _, tc := range cases {
		if got := lpKind(lpInteractive{TagName: tc.tag, Type: tc.typ}); got != tc.want {
			t.Errorf("lpKind(%s type=%q) = %q, want %q", tc.tag, tc.typ, got, tc.want)
		}
	}
}

// The guard must name the element without naming its value: a fill changes the
// value, and a fill that trips its own freshness check can never land.
func TestLPGuardHoldsNoValue(t *testing.T) {
	snap := lpBuildSnapshot("https://x.test", "t", "md", lpInteractiveResult{
		Elements: []lpInteractive{
			{BackendNodeID: 7, TagName: "input", Type: "text", Name: "Email"},
		},
	})
	if g, ok := snap.Guards["7"]; !ok {
		t.Fatal("element 7 must have a guard")
	} else if len(g) != 3 {
		t.Errorf("guard should hold tag, role and href only, got %v", g)
	}
	for _, v := range snap.Guards["7"] {
		if s, ok := v.(string); ok && s == "Email" {
			t.Error("guard must not carry the accessible name as a value slot")
		}
	}
	// Every action needs a guard, or checkFresh refuses it forever.
	for _, a := range snap.Actions {
		if a.Kind == "wait" {
			continue
		}
		key := fmt.Sprintf("%d", a.Node)
		if _, ok := snap.Guards[key]; !ok {
			t.Errorf("action %s (%s) has no guard", a.ID, a.Kind)
		}
	}
	// The wait escape must exist so the judge is never forced to act.
	var hasWait bool
	for _, a := range snap.Actions {
		if a.Kind == "wait" {
			hasWait = true
		}
	}
	if !hasWait {
		t.Error("snapshot must offer a wait action")
	}
}

// A filled field must change the fingerprint, or the loop reads its own write
// as no change and never notices progress.
func TestLPFillChangesFingerprint(t *testing.T) {
	els := lpInteractiveResult{Elements: []lpInteractive{
		{BackendNodeID: 7, TagName: "input", Type: "text", Name: "Email"},
	}}
	before := lpBuildSnapshot("https://x.test", "t", "md", els)
	els.Elements[0].Name = "Email filled"
	after := lpBuildSnapshot("https://x.test", "t", "md", els)
	if fingerprintSnap(before) == fingerprintSnap(after) {
		t.Error("a changed element list must change the fingerprint")
	}
}



func TestHostAllowed(t *testing.T) {
	cases := []struct {
		allow string
		url   string
		want  bool
	}{
		{"", "https://anything.test/x", true}, // opt-in: empty allows all
		{"example.com", "https://example.com/a", true},
		{"example.com", "https://sub.example.com/a", true},
		{"example.com", "https://notexample.com/a", false},
		{"example.com", "https://evil.com/?x=example.com", false},
		{"*.example.com", "https://sub.example.com/", true},
		{"*.example.com", "https://example.com/", false},
		{"a.com,b.com", "https://b.com/x", true},
		{"a.com,b.com", "https://c.com/x", false},
		{"*", "https://whatever.test/", true},
		{"example.com", "not a url at all", false},
	}
	for _, tc := range cases {
		got, err := hostAllowed(tc.allow, tc.url)
		if err != nil {
			t.Errorf("hostAllowed(%q, %q) error %v", tc.allow, tc.url, err)
			continue
		}
		if got != tc.want {
			t.Errorf("hostAllowed(%q, %q) = %v, want %v", tc.allow, tc.url, got, tc.want)
		}
	}
}

func TestCheckURLPolicy(t *testing.T) {
	if err := checkURLPolicy("", "https://anything.test"); err != nil {
		t.Errorf("empty allowlist must permit: %v", err)
	}
	if err := checkURLPolicy("example.com", ""); err != nil {
		t.Errorf("empty url is attach, must pass: %v", err)
	}
	err := checkURLPolicy("example.com", "https://evil.com")
	if err == nil {
		t.Fatal("expected refusal for a host outside the allowlist")
	}
	// The caller must be able to tell policy refusal from a network failure.
	if got := err.Error(); len(got) < len("url_not_allowed") || got[:len("url_not_allowed")] != "url_not_allowed" {
		t.Errorf("error must be tagged url_not_allowed, got %q", got)
	}
}