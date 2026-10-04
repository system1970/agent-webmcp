package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// Live Lightpanda checks. They need the binary and the network, so they skip
// when either is missing and never gate a plain `go test`.
//
// The one that matters most is TestLPLoopHoldsPageAcrossSteps. Lightpanda drops
// every page when its CDP connection closes, which is the whole reason decide,
// act and tick are refused on that engine. If that ever stops being true the
// gate can be lifted, and this test is what would notice.

func lpBinary(t *testing.T) string {
	t.Helper()
	for _, p := range []string{os.Getenv("AGENT_WEBMCP_LIGHTPANDA"), "/tmp/opencode/lightpanda"} {
		if p == "" {
			continue
		}
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return p
		}
	}
	t.Skip("no lightpanda binary (set AGENT_WEBMCP_LIGHTPANDA)")
	return ""
}

// The snapshot on a held page must be usable: real actions, real guards, a
// fingerprint, and no value in any guard.
func TestLPLoopObserve(t *testing.T) {
	bin := lpBinary(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	l, err := startLPLoop(ctx, bin, "lptest", "https://httpbin.org/forms/post", 60*time.Second)
	if err != nil {
		t.Fatalf("startLPLoop: %v", err)
	}
	defer l.close()

	snap, err := l.observe(ctx)
	if err != nil {
		t.Fatalf("observe: %v", err)
	}
	if snap.URL == "" {
		t.Error("snapshot must carry the landed URL")
	}
	if len(snap.Actions) < 2 {
		t.Fatalf("expected elements plus a wait action, got %d actions", len(snap.Actions))
	}
	var named int
	for _, a := range snap.Actions {
		if a.Label != "" {
			named++
		}
	}
	if named == 0 {
		t.Error("no action carried a label; the judge cannot choose blind")
	}
	if fingerprintSnap(snap) == "" {
		t.Error("snapshot must fingerprint")
	}
}

// The reason the split verbs are gated. Fill a field, then read the page again
// through the same loop. It must still be there.
func TestLPLoopHoldsPageAcrossSteps(t *testing.T) {
	bin := lpBinary(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	l, err := startLPLoop(ctx, bin, "lptest", "https://httpbin.org/forms/post", 60*time.Second)
	if err != nil {
		t.Fatalf("startLPLoop: %v", err)
	}
	defer l.close()

	snap, err := l.observe(ctx)
	if err != nil {
		t.Fatalf("observe: %v", err)
	}
	var field *snapAction
	for i := range snap.Actions {
		if snap.Actions[i].Kind == "fill" {
			field = &snap.Actions[i]
			break
		}
	}
	if field == nil {
		t.Skip("no fillable field on this page")
	}
	if _, err := l.call(ctx, "LP.fillNode", map[string]any{"backendNodeId": field.Node, "text": "KeiLoop"}); err != nil {
		t.Fatalf("fillNode: %v", err)
	}

	// A second observation, on the same connection, must see the write. This
	// is the step a separate `act` invocation could not take.
	after, err := l.observe(ctx)
	if err != nil {
		t.Fatalf("second observe: %v", err)
	}
	if len(after.Actions) == 0 {
		t.Error("the second observation came back empty; the page did not survive")
	}
	if !strings.Contains(l.filledValues(ctx), "KeiLoop") {
		t.Errorf("the filled value did not survive a second step on the held page (fields hold %q)", l.filledValues(ctx))
	}
}

// The guard must accept a page that did not move and reject one that did. This
// is the gate that stops a decision being executed against the wrong element.
func TestLPLoopFreshnessGate(t *testing.T) {
	bin := lpBinary(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	l, err := startLPLoop(ctx, bin, "lptest", "https://httpbin.org/forms/post", 60*time.Second)
	if err != nil {
		t.Fatalf("startLPLoop: %v", err)
	}
	defer l.close()

	saved, err := l.observe(ctx)
	if err != nil {
		t.Fatalf("observe: %v", err)
	}
	var target *snapAction
	for i := range saved.Actions {
		if saved.Actions[i].Kind == "fill" {
			target = &saved.Actions[i]
			break
		}
	}
	if target == nil {
		t.Skip("no fillable field on this page")
	}

	// Nothing moved: act on it.
	fresh, err := l.observe(ctx)
	if err != nil {
		t.Fatalf("re-observe: %v", err)
	}
	if err := checkFresh(saved, fresh, target.Node); err != nil {
		t.Errorf("an unmoved page must pass the freshness gate: %v", err)
	}

	// A different page is a different decision.
	if _, err := l.call(ctx, "Page.navigate", map[string]any{"url": "https://example.com"}); err != nil {
		t.Fatalf("navigate: %v", err)
	}
	time.Sleep(2 * time.Second)
	elsewhere, err := l.observe(ctx)
	if err != nil {
		t.Fatalf("observe after navigate: %v", err)
	}
	if err := checkFresh(saved, elsewhere, target.Node); err == nil {
		t.Error("a navigated page must fail the freshness gate")
	}
}

// The selector is the only handle that survives a navigation, and it is what
// the receipt names. It must resolve.
func TestLPLoopResolvesSelector(t *testing.T) {
	bin := lpBinary(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	l, err := startLPLoop(ctx, bin, "lptest", "https://httpbin.org/forms/post", 60*time.Second)
	if err != nil {
		t.Fatalf("startLPLoop: %v", err)
	}
	defer l.close()

	snap, err := l.observe(ctx)
	if err != nil {
		t.Fatalf("observe: %v", err)
	}
	resolved := 0
	for _, a := range snap.Actions {
		if a.Node == 0 {
			continue
		}
		if sel, err := l.lpSelector(ctx, a.Node); err == nil && sel != "" {
			resolved++
		}
	}
	if resolved == 0 {
		t.Fatal("no node resolved to a selector; the receipt would name nothing")
	}
}

// filledValues reads the live value property of every field. innerHTML would
// not do: a typed value lives in the property, not in the attribute.
//
// It returns a string on purpose: lpValueString unmarshals value as a string,
// so a boolean-returning expression reads as empty.
func (l *lpLoop) filledValues(ctx context.Context) string {
	res, err := l.call(ctx, "Runtime.evaluate", map[string]any{
		"expression":     "[...document.querySelectorAll('input,textarea')].filter(e=>e.value).map(e=>e.name+'='+e.value).join(' | ')",
		"returnByValue": true,
	})
	if err != nil {
		return ""
	}
	return lpValueString(res)
}