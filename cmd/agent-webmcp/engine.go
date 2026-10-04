package main

// Engine selection. Chrome is the default. Lightpanda is the fast engine and it
// runs the fused run loop, but not the split verbs.
//
// What Lightpanda does well: LP.getInteractiveElements returns real,
// well-shaped elements with accessible names (see lightpanda.go), and it
// resolves a node by id, so no geometry is needed. LP.clickNode and
// LP.fillNode both work against a backendNodeId.
//
// What it cannot do here: it drops all page state when the CDP connection
// closes. decide observes in one process and act acts in the next, so on
// Lightpanda the second process finds about:blank. run holds one connection
// for every step, which is why run works and decide, act and tick do not.
//
// Geometry is still refused: getBoundingClientRect is approximate, so
// elementFromPoint cannot be trusted to hit the right element. That rules out
// the Chrome hit-test, not the Lightpanda node path.

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
	// FeatureSplitVerbs is decide/act as separate processes. FeatureAct,
	// FeatureGeometry and FeatureHitTest were the earlier names for parts of
	// this; the refusal is now one fact about the connection, not three
	// facts about geometry.
	FeatureSplitVerbs Feature = "the split verbs decide/act/tick"
	FeatureWebMCP    Feature = "WebMCP page tools"
	FeatureHeaded    Feature = "headed mode"
	FeatureProfiles  Feature = "persistent profiles"
	FeatureLayout    Feature = "element geometry / hit-testing"
	FeatureLoginFlow Feature = "auth handoff login"
)

var engineSupport = map[Engine]map[Feature]string{
	EngineChrome: {},
	EngineLightpanda: {
		// Lightpanda resolves a node directly and drops all page state when
		// its CDP connection closes, so the fused run loop works and the split
		// verbs cannot. See lploop.go.
		FeatureSplitVerbs: "lightpanda forgets every page when its CDP connection closes, so decide and act cannot be separate processes; use run",
		FeatureWebMCP:     "not verified on lightpanda: the LP domain exposes WebMCP.invokeTool, but no site has been driven through it here",
		FeatureHeaded:     "headless only",
		FeatureProfiles:   "no --user-data-dir; cookies load read-only via --cookie and save on exit via --cookie-jar",
		FeatureLayout:     "no layout engine: getBoundingClientRect is approximate, so elementFromPoint cannot be trusted to hit the right element",
		FeatureLoginFlow:  "needs headed mode",
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

// requireChrome refuses a feature that only Chrome has. Used where the caller
// knows no other engine is in play.
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