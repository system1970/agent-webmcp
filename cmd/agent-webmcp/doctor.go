package main

import (
	"context"
	"fmt"
	"os"
	"time"
)

// doctor: one runnable diagnostic. Version, Chrome, sessions, key
// presence (bool only, never the value), registry shape, vault count,
// plus one live headless open+close on a throwaway session. Exit 0
// all-pass, 1 any fail. The troubleshooting page links here.

type doctorCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

func doctorCmd(ctx context.Context, g *globals, rest []string) int {
	_ = rest
	timeout := 30 * time.Second
	var checks []doctorCheck
	add := func(name string, ok bool, detail string) {
		checks = append(checks, doctorCheck{Name: name, OK: ok, Detail: detail})
	}

	add("version", true, "agent-webmcp "+version)

	chromeBin, cerr := findChrome(g.chrome)
	if cerr != nil {
		add("chrome", false, cerr.Error())
	} else {
		add("chrome", true, chromeBin)
	}

	names := mustSessionNames()
	live := 0
	for _, n := range names {
		if _, err := sessionTarget(n, 10*time.Second); err == nil {
			live++
		}
	}
	add("sessions", true, fmt.Sprintf("%d known, %d live", len(names), live))

	if jevKey() == "" {
		add("typesafe_key", false, "TYPESAFE_API_KEY unset (free tier works, ultrafast refuses)")
	} else {
		add("typesafe_key", true, "set")
	}

	tools, terr := loadCustomTools()
	if terr != nil {
		add("registry", false, terr.Error())
	} else {
		verified := 0
		for _, m := range tools {
			if m.Verified {
				verified++
			}
		}
		add("registry", true, fmt.Sprintf("%d tools, %d verified", len(tools), verified))
	}

	backend, berr := backendFor(os.Getenv("AGENT_WEBMCP_VAULT"))
	if berr != nil {
		add("secrets", false, berr.Error())
	} else if detail, serr := backend.Status(ctx); serr != nil {
		add("secrets", false, serr.Error())
	} else {
		add("secrets", true, fmt.Sprintf("%s: %s", backend.Name(), detail))
	}

	if cerr == nil {
		const probe = "doctor-check"
		ctx2, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		if _, err := openURL(ctx2, probe, "https://example.com/", chromeBin, false, allowedDomainsFromEnv(), timeout); err != nil {
			add("live_open", false, err.Error())
		} else {
			_ = closeSession(probe)
			add("live_open", true, "open+close example.com headless")
		}
	}

	pass := true
	for _, c := range checks {
		if !c.OK {
			pass = false
			break
		}
	}
	if g.json {
		ok(map[string]any{"checks": checks, "pass": pass})
		if pass {
			return 0
		}
		return 1
	}
	for _, c := range checks {
		mark := "pass"
		if !c.OK {
			mark = "FAIL"
		}
		fmt.Printf("%-12s %-4s %s\n", c.Name, mark, c.Detail)
	}
	if pass {
		return 0
	}
	return 1
}
