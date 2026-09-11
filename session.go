package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Session state lives under ~/.orkestrate/sessions/<name>/.
// Files: cdp-port, chrome.pid, profile/ (chrome user-data-dir).
func sessionRoot() string {
	if v := os.Getenv("ORKESTRATE_HOME"); v != "" {
		return v
	}
	h, err := os.UserHomeDir()
	if err != nil || h == "" {
		return ".orkestrate"
	}
	return filepath.Join(h, ".orkestrate", "sessions")
}

func sessionDir(name string) string {
	return filepath.Join(sessionRoot(), sanitizeSession(name))
}

func sanitizeSession(s string) string {
	if s == "" {
		return "default"
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	out := b.String()
	if out == "" {
		return "default"
	}
	return out
}

func readPort(name string) (int, error) {
	p := filepath.Join(sessionDir(name), "cdp-port")
	b, err := os.ReadFile(p)
	if err != nil {
		return 0, errors.New("no active session '" + name + "' (run: orkestrate open)")
	}
	n, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil || n <= 0 {
		return 0, errors.New("corrupt port file for session '" + name + "'")
	}
	return n, nil
}

func writePort(name string, port int) error {
	d := sessionDir(name)
	if err := os.MkdirAll(d, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(d, "cdp-port"), []byte(strconv.Itoa(port)), 0o644)
}

func writePid(name string, pid int) error {
	return os.WriteFile(filepath.Join(sessionDir(name), "chrome.pid"), []byte(strconv.Itoa(pid)), 0o644)
}

func readPid(name string) int {
	b, err := os.ReadFile(filepath.Join(sessionDir(name), "chrome.pid"))
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return n
}

func profileDir(name string) string {
	return filepath.Join(sessionDir(name), "profile")
}
