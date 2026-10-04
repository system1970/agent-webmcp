package main

import "testing"

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

// Lightpanda must refuse everything that needs layout or Chrome APIs. A
// silent degradation here would mean acting on the wrong element.
func TestEngineGates(t *testing.T) {
	lp := EngineLightpanda
	if err := requireChrome(lp, FeatureAct); err == nil {
		t.Error("act must be refused on lightpanda")
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
	if err := requireChrome(lp, FeatureLoginFlow); err == nil {
		t.Error("login flow must be refused on lightpanda")
	}
	ch := EngineChrome
	for _, f := range []Feature{FeatureAct, FeatureWebMCP, FeatureHeaded, FeatureProfiles, FeatureLayout, FeatureLoginFlow} {
		if err := requireChrome(ch, f); err != nil {
			t.Errorf("chrome must allow %s, got %v", f, err)
		}
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