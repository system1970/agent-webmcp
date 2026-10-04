package main

import (
	"encoding/json"
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

// lpFixture is what Lightpanda actually reported for a page holding every
// control kind: a text input, email, search, number, password, radio, checkbox,
// submit, button input, <select>, textarea, button and link.
//
// getInteractiveElements reports type "native" for every one of them, so the
// fixture keeps that: a mapping that reads Type is not being tested against
// real input. The input types come from LP.getNodeDetails, which is where the
// real control type lives.
func lpFixture() (lpInteractiveResult, []lpNodeDetails) {
	ir := lpInteractiveResult{Elements: []lpInteractive{
		{BackendNodeID: 1, TagName: "input", Role: "textbox", Name: "Text", Type: "native"},
		{BackendNodeID: 2, TagName: "input", Role: "textbox", Name: "Email", Type: "native"},
		{BackendNodeID: 3, TagName: "input", Role: "searchbox", Name: "Search", Type: "native"},
		{BackendNodeID: 4, TagName: "input", Role: "spinbutton", Name: "Number", Type: "native"},
		{BackendNodeID: 5, TagName: "input", Role: "textbox", Name: "Password", Type: "native"},
		{BackendNodeID: 6, TagName: "input", Role: "radio", Type: "native"},
		{BackendNodeID: 7, TagName: "input", Role: "checkbox", Type: "native"},
		{BackendNodeID: 8, TagName: "input", Role: "button", Name: "Go", Type: "native"},
		{BackendNodeID: 9, TagName: "input", Role: "button", Name: "Press", Type: "native"},
		{BackendNodeID: 10, TagName: "select", Role: "combobox", Type: "native"},
		{BackendNodeID: 11, TagName: "textarea", Role: "textbox", Name: "Notes", Type: "native"},
		{BackendNodeID: 12, TagName: "button", Role: "button", Name: "Do it", Type: "native"},
		{BackendNodeID: 13, TagName: "a", Role: "link", Name: "Next page", Href: "/next", Type: "native"},
	}}
	d := make([]lpNodeDetails, 13)
	for i, t := range []string{
		"text", "email", "search", "number", "password",
		"radio", "checkbox", "submit", "button", "", "", "", "",
	} {
		d[i] = lpNodeDetails{InputType: t}
	}
	d[9].Options = []struct {
		Value    string `json:"value"`
		Text     string `json:"text"`
		Selected bool   `json:"selected"`
	}{{Value: "o1", Text: "One", Selected: true}, {Value: "o2", Text: "Two"}}
	return ir, d
}

// The mapping must agree with the vocabulary observeJS uses, because one judge
// reads both engines' snapshots.
func TestLPKindVocabulary(t *testing.T) {
	want := []string{
		"fill", "fill", "fill", "fill", "fill", // text email search number password
		"click", "click", // radio checkbox
		"click", "click", // submit, button input
		"select", // the <select> itself
		"fill", "click", "click", // textarea, button, link
	}
	ir, details := lpFixture()
	var got []string
	for i, e := range ir.Elements {
		got = append(got, lpKind(e, details[i]))
	}
	// The <select> expands to one action per option, so it appears once here
	// and twice in the snapshot.
	for i := range want {
		if i >= len(got) {
			break
		}
		if got[i] != want[i] {
			t.Errorf("element %d (%s role=%s inputType=%s) mapped to %q, want %q",
				i+1, ir.Elements[i].TagName, ir.Elements[i].Role,
				details[i].InputType, got[i], want[i])
		}
	}
}

// A checkbox offered as a text field is the exact failure this guards: the
// judge is told to TYPE into something that can only be clicked.
func TestLPKindNeverOffersAToggleAsFill(t *testing.T) {
	for _, typ := range []string{"checkbox", "radio", "submit", "button", "image", "reset"} {
		e := lpInteractive{TagName: "input", Role: "textbox", Type: "native"}
		if got := lpKind(e, lpNodeDetails{InputType: typ}); got != "click" {
			t.Errorf("input type %q mapped to %q, want click", typ, got)
		}
	}
}

// A password field must not be offered on either engine. observeJS refuses
// password, file and hidden; if lightpanda offered them, the judge would be
// invited to type a secret into a field it should never see.
func TestLPHidesSecretAndFileInputs(t *testing.T) {
	for _, typ := range []string{"password", "file", "hidden"} {
		ir := lpInteractiveResult{Elements: []lpInteractive{
			{BackendNodeID: 1, TagName: "input", Role: "textbox", Name: "Secret", Type: "native"},
		}}
		snap := lpBuildSnapshot("https://x.test", "t", "", ir, []lpNodeDetails{{InputType: typ}})
		for _, a := range snap.Actions {
			if a.Kind == "wait" {
				continue
			}
			t.Errorf("input type %q was offered to the judge as %s %q", typ, a.Kind, a.Label)
		}
	}
	// The real fixture must lose exactly its password field.
	ir, details := lpFixture()
	snap := lpBuildSnapshot("https://x.test", "t", "", ir, details)
	for _, a := range snap.Actions {
		if a.Kind == "wait" {
			continue
		}
		if a.Node == 5 {
			t.Error("the password field reached the snapshot")
		}
	}
}

// The tag fallback must still hold when there is no inputType, because not
// every element is an <input> and a failed details read must not hide a
// control the judge could use.
func TestLPKindFallsBackToRoleAndTag(t *testing.T) {
	if got := lpKind(lpInteractive{TagName: "select", Role: "combobox", Type: "native"}, lpNodeDetails{}); got != "select" {
		t.Errorf("a <select> with no inputType mapped to %q, want select", got)
	}
	if got := lpKind(lpInteractive{TagName: "textarea", Role: "textbox", Type: "native"}, lpNodeDetails{}); got != "fill" {
		t.Errorf("a <textarea> with no inputType mapped to %q, want fill", got)
	}
	// An element with neither details nor a usable role is still offered.
	if got := lpKind(lpInteractive{TagName: "div", Type: "native"}, lpNodeDetails{}); got != "click" {
		t.Errorf("an unknown element mapped to %q, want click", got)
	}
}

// A dropdown must be offered one action per option, the way observeJS offers
// it, so the judge chooses an option by name and needs no --params.
func TestLPSelectOffersOneActionPerOption(t *testing.T) {
	ir, details := lpFixture()
	snap := lpBuildSnapshot("https://x.test", "t", "", ir, details)
	var opts []snapAction
	for _, a := range snap.Actions {
		if a.Kind == "select" {
			opts = append(opts, a)
		}
	}
	// One option is already selected, so observeJS skips it. Two options, one
	// selected, leaves exactly one offerable action.
	if len(opts) != 1 {
		t.Fatalf("want 1 offerable option (the selected one is skipped), got %d: %+v", len(opts), opts)
	}
	if opts[0].Value != "o2" {
		t.Errorf("option value = %q, want o2", opts[0].Value)
	}
	if opts[0].Node != 10 {
		t.Errorf("option action must point at the select node, got %d", opts[0].Node)
	}
}

// The guard must name the element without naming its value: a fill changes the
// value, and a fill that trips its own freshness check can never land.
func TestLPGuardHoldsNoValue(t *testing.T) {
	ir, details := lpFixture()
	details[0].Value = "typed-secret"
	snap := lpBuildSnapshot("https://x.test", "t", "md", ir, details)
	g, ok := snap.Guards["1"]
	if !ok {
		t.Fatal("element 1 must have a guard")
	}
	for _, v := range g {
		if s, isStr := v.(string); isStr && s == "typed-secret" {
			t.Error("the guard must not carry the field value")
		}
	}
	// Every action needs a guard, or checkFresh refuses it forever.
	for _, a := range snap.Actions {
		if a.Kind == "wait" {
			continue
		}
		if _, ok := snap.Guards[fmt.Sprintf("%d", a.Node)]; !ok {
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
	ir, details := lpFixture()
	before := lpBuildSnapshot("https://x.test", "t", "md", ir, details)
	details[0].Value = "now filled"
	after := lpBuildSnapshot("https://x.test", "t", "md", ir, details)
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

// A page mid-navigation returns no document. That must read as what it is, not
// as a JSON parse error: the loop re-observes right after a click, so this is
// the normal state of a navigating page and the run is about to succeed.
func TestSnapshotFromOutputNamesTheRealFailure(t *testing.T) {
	for _, empty := range []string{"", "   ", "\n\t "} {
		_, err := snapshotFromOutput(empty)
		if err == nil {
			t.Fatalf("empty output %q must be an error", empty)
		}
		if !strings.Contains(err.Error(), "page_navigating") {
			t.Errorf("empty output must report page_navigating, got %v", err)
		}
		if strings.Contains(err.Error(), "unexpected end of JSON") {
			t.Errorf("a navigating page must not surface a JSON parse error: %v", err)
		}
	}
	// Real output must still parse.
	snap, err := snapshotFromOutput(`{"url":"https://x.test","title":"T","actions":[{"id":"e1","kind":"click","label":"Go"}]}`)
	if err != nil {
		t.Fatalf("valid output must parse: %v", err)
	}
	if snap.URL != "https://x.test" || len(snap.Actions) != 1 {
		t.Errorf("parsed snapshot is wrong: %+v", snap)
	}
	// Malformed output is still an error, and says which side is wrong.
	if _, err := snapshotFromOutput("{not json"); err == nil {
		t.Error("malformed output must be an error")
	} else if !strings.Contains(err.Error(), "observe output") {
		t.Errorf("malformed output must say so, got %v", err)
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

// Redaction must not depend on the engine. buildState is the only thing
// serialized into the Jev request, so whatever it drops is what the model never
// sees. Lightpanda snapshots carry values now (lpStampValues reads them back so
// the judge can tell a fill landed), which means the LP shape has to be pinned
// here too, not just the hand-built chrome one in policy_test.go.
func TestBuildStateRedactsOnBothEngines(t *testing.T) {
	const secret = "s3cret-pw-do-not-send"

	// Chrome shape: observeJS fills Value straight from the DOM.
	chrome := &snapshot{
		URL: "https://x.test/login", Title: "Login", Text: "Sign in",
		Actions: []snapAction{
			{ID: "e1", Kind: "fill", Role: "textbox", Label: "Password", Value: secret},
			{ID: "e2", Kind: "click", Role: "button", Label: "Sign in"},
		},
	}

	// Lightpanda shape: a normal text field holding a secret, which is the
	// realistic PII case (an account identifier, a licence key, an email).
	// A password field never reaches this point: lpBuildSnapshot hides it.
	lp := lpBuildSnapshot("https://x.test/login", "Login", "Sign in", lpInteractiveResult{
		Elements: []lpInteractive{
			{BackendNodeID: 11, TagName: "input", Role: "textbox", Name: "Account ID", Type: "native"},
			{BackendNodeID: 12, TagName: "button", Role: "button", Name: "Sign in", Type: "native"},
		},
	}, []lpNodeDetails{
		{InputType: "text", Value: secret},
		{},
	})

	// A field holding the secret must read as filled, or the loop refills it
	// forever. The value itself must not travel.
	for name, snap := range map[string]*snapshot{"chrome": chrome, "lightpanda": lp} {
		state := buildState("sign in", snap, nil, []map[string]any{
			{"operation": "TYPE_TEXT", "target": snap.Actions[0].ID, "text": secret, "page_changed": true, "confidence": 0.9},
		}, nil)
		raw, err := json.Marshal(state)
		if err != nil {
			t.Fatalf("%s: marshal state: %v", name, err)
		}
		if strings.Contains(string(raw), secret) {
			t.Errorf("%s: the field value reached Jev state: %s", name, raw)
		}
		if name == "lightpanda" && !strings.Contains(string(raw), `"filled":true`) {
			t.Errorf("lightpanda: a filled field must read as filled, got %s", raw)
		}
	}
}

// The WebMCP refusal must state the structural reason, not "unverified". An
// agent that hits it needs to know that no amount of retrying will help, and
// that the domain existing is not the same as the feature working.
func TestWebMCPRefusalIsStructural(t *testing.T) {
	msg := requireChrome(EngineLightpanda, FeatureWebMCP).Error()
	for _, want := range []string{"document.modelContext", "invokeTool"} {
		if !strings.Contains(msg, want) {
			t.Errorf("WebMCP refusal must mention %s, got %q", want, msg)
		}
	}
	for _, never := range []string{"unverified", "not been driven"} {
		if strings.Contains(msg, never) {
			t.Errorf("the refusal must not imply it might work (%q): %q", never, msg)
		}
	}
}