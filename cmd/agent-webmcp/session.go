package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// One session = one isolated Chrome: session dir holds cdp-port,
// chrome.pid and profile/. The browser outlives each CLI call.

func sessionRoot() string {
	if v := os.Getenv("AGENT_WEBMCP_HOME"); v != "" {
		return filepath.Join(v, "sessions")
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return filepath.Join(h, ".agent-webmcp", "sessions")
	}
	return ".agent-webmcp-sessions"
}

func sanitizeSession(name string) string {
	var b strings.Builder
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "default"
	}
	return b.String()
}

func sessionDir(name string) string {
	return filepath.Join(sessionRoot(), sanitizeSession(name))
}

func readPid(name string) (int, error) {
	b, err := os.ReadFile(filepath.Join(sessionDir(name), "chrome.pid"))
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(b)))
}

func sessionNames() ([]string, error) {
	ents, err := os.ReadDir(sessionRoot())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []string
	for _, e := range ents {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	return out, nil
}

func mustSessionNames() []string {
	names, _ := sessionNames()
	return names
}
