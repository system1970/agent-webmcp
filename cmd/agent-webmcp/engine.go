package main

// Engine selection. Chrome is the default and the only engine that can act.
// Lightpanda is read-only: it is fast and light, and it has no layout engine,
// so element geometry is approximate and anything that hit-tests or drives
// input must stay on Chrome.
//
// Why Lightpanda is read-only here: LP.getInteractiveElements returns real,
// well-shaped element data (see lightpanda.go), but getBoundingClientRect
// reports approximate boxes and document.elementFromPoint resolves against
// them. act's freshness guard (act.go) would therefore certify a decision
// against the wrong element. A hard error is better than a wrong target.

import (
	"fmt"
	"os"
	"strings"
)

type Engine string

const (
	EngineChrome     Engine = "chrome"
	EngineLightpanda Engine = "lightpanda"
)

func parseEngine(v string) (Engine, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "chrome", "chromium":
		return EngineChrome, nil
	case "lightpanda", "lp":
		return EngineLightpanda, nil
	default:
		return "", fmt.Errorf("unknown engine %q (want chrome or lightpanda)", v)
	}
}

// Feature is a capability that only one engine has.
type Feature string

const (
	FeatureAct       Feature = "act"
	FeatureWebMCP    Feature = "WebMCP page tools"
	FeatureHeaded    Feature = "headed mode"
	FeatureProfiles  Feature = "persistent profiles"
	FeatureLayout    Feature = "element geometry / hit-testing"
	FeatureLoginFlow Feature = "auth handoff login"
)

var engineSupport = map[Engine]map[Feature]string{
	EngineChrome: {},
	EngineLightpanda: {
		FeatureAct:       "no layout engine: getBoundingClientRect is approximate, so act could hit the wrong element",
		FeatureWebMCP:    "Chrome-only: window.modelContext does not exist",
		FeatureHeaded:    "headless only",
		FeatureProfiles:  "no --user-data-dir; cookies load read-only via --cookie and save on exit via --cookie-jar",
		FeatureLayout:    "no layout engine",
		FeatureLoginFlow: "needs headed mode",
	},
}

// requireEngine returns a clear error when the active engine cannot do feat.
// Mirrors agent-browser: combining an engine with an unsupported flag is a
// refusal, not a silent degradation.
func requireEngine(e Engine, feat Feature) error {
	if reasons, bad := engineSupport[e][feat]; bad {
		return fmt.Errorf("%s is not available on engine %s: %s", feat, e, reasons)
	}
	return nil
}

// requireChrome is the common case: acting only happens on Chrome.
func requireChrome(e Engine, feat Feature) error {
	if e != EngineChrome {
		return fmt.Errorf("%s requires the chrome engine (running %s): %s", feat, e, engineSupport[e][feat])
	}
	return nil
}

// hostAllowed reports whether rawURL passes an allowlist. An empty allowlist
// allows everything. Patterns are case-insensitive host globs; "*" matches any
// run of characters. "*.example.com" matches sub.example.com but not
// example.com; "example.com" matches only that host and its subdomains, so a
// caller who means one host writes it and gets the obvious behaviour.
func hostAllowed(allow, rawURL string) (bool, error) {
	allow = strings.TrimSpace(allow)
	if allow == "" {
		return true, nil
	}
	host := normalizeHost(rawURL)
	if host == "" {
		return false, fmt.Errorf("cannot read host from %q", rawURL)
	}
	for _, pat := range strings.Split(allow, ",") {
		pat = strings.ToLower(strings.TrimSpace(pat))
		if pat == "" {
			continue
		}
		// Same semantics as customToolsForHost: "*" any, exact host, or a
		// parent domain ("example.com" also covers sub.example.com).
		if pat == "*" || host == pat || strings.HasSuffix(host, "."+strings.TrimPrefix(pat, "*.")) {
			return true, nil
		}
	}
	return false, nil
}

// checkURLPolicy is called at every navigation entry point. Deny is reported
// as url_not_allowed so callers can distinguish it from a network failure.
func checkURLPolicy(allow, rawURL string) error {
	if strings.TrimSpace(rawURL) == "" {
		return nil // attach, not navigate
	}
	ok, err := hostAllowed(allow, rawURL)
	if err != nil {
		return fmt.Errorf("url_not_allowed: %v", err)
	}
	if !ok {
		return fmt.Errorf("url_not_allowed: %s is not in the allowlist (set AGENT_WEBMCP_ALLOWED_DOMAINS or pass --allowed-domains)", normalizeHost(rawURL))
	}
	return nil
}

// allowedDomainsFromEnv is the opt-in default. Empty means no restriction,
// which keeps every existing invocation working; the flag and the env var are
// how a caller turns the policy on.
func allowedDomainsFromEnv() string { return os.Getenv("AGENT_WEBMCP_ALLOWED_DOMAINS") }