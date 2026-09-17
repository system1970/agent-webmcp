package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Session state lives under ~/.agent-webmcp/sessions/<name>/.
// Files: cdp-port, chrome.pid, profile/ (chrome user-data-dir).
// AGENT_WEBMCP_HOME overrides the ~/.agent-webmcp root (sessions + tools).
func sessionRoot() string {
	if v := os.Getenv("AGENT_WEBMCP_HOME"); v != "" {
		return filepath.Join(v, "sessions")
	}
	h, err := os.UserHomeDir()
	if err != nil || h == "" {
		return filepath.Join(".agent-webmcp", "sessions")
	}
	return filepath.Join(h, ".agent-webmcp", "sessions")
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
		return 0, errors.New("no active session '" + name + "' (run: agent-webmcp open)")
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

// SessionMeta is the picker record for a session: purpose + recency.
// Stored at sessions/<name>/meta.json. Missing file = unlabeled legacy session.
type SessionMeta struct {
	Desc     string `json:"desc,omitempty"`
	Created  string `json:"created,omitempty"`
	LastUsed string `json:"lastUsed,omitempty"`
	LastURL  string `json:"lastURL,omitempty"`
}

func metaPath(name string) string {
	return filepath.Join(sessionDir(name), "meta.json")
}

// readMeta returns the stored record, or zero value when absent/corrupt.
func readMeta(name string) SessionMeta {
	var m SessionMeta
	b, err := os.ReadFile(metaPath(name))
	if err != nil {
		return m
	}
	_ = json.Unmarshal(b, &m)
	return m
}

// writeDesc sets the purpose label, creating the record when needed.
// Empty desc keeps the existing label.
func writeDesc(name, desc string) {
	desc = strings.TrimSpace(desc)
	if desc == "" {
		return
	}
	if len(desc) > 140 {
		desc = strings.TrimSpace(desc[:140])
	}
	m := readMeta(name)
	now := time.Now().UTC().Format(time.RFC3339)
	if m.Created == "" {
		m.Created = now
	}
	m.Desc = desc
	m.LastUsed = now
	_ = os.MkdirAll(sessionDir(name), 0o755)
	b, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(metaPath(name), b, 0o644)
}

// touchSession records recency + last URL without changing the label.
func touchSession(name, url string) {
	m := readMeta(name)
	now := time.Now().UTC().Format(time.RFC3339)
	if m.Created == "" {
		m.Created = now
	}
	m.LastUsed = now
	if strings.TrimSpace(url) != "" {
		m.LastURL = url
	}
	_ = os.MkdirAll(sessionDir(name), 0o755)
	b, _ := json.Marshal(m)
	_ = os.WriteFile(metaPath(name), b, 0o644)
}

// idleFor renders LastUsed (RFC3339) as "5m", "3h", "2d". Empty on unknown.
func idleFor(lastUsed string) string {
	if strings.TrimSpace(lastUsed) == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, lastUsed)
	if err != nil {
		return ""
	}
	d := time.Since(t)
	if d < 0 {
		d = 0
	}
	switch {
	case d < time.Hour:
		m := int(d.Minutes())
		if m < 1 {
			return "just now"
		}
		return strconv.Itoa(m) + "m"
	case d < 48*time.Hour:
		return strconv.Itoa(int(d.Hours())) + "h"
	default:
		return strconv.Itoa(int(d.Hours()/24)) + "d"
	}
}

type scanItem struct {
	Role string `json:"role"`
	Name string `json:"name"`
	Sel  string `json:"sel,omitempty"`
	FP   string `json:"fp,omitempty"`
	CBID int64  `json:"cbid,omitempty"`
}

func scanCachePath(session string) string {
	return filepath.Join(sessionDir(session), "scan.json")
}

func scanCacheSave(session, url string, items []map[string]any) {
	type entry struct {
		URL   string     `json:"url"`
		Items []scanItem `json:"items"`
	}
	e := entry{URL: url}
	for _, it := range items {
		r, _ := it["role"].(string)
		n, _ := it["name"].(string)
		s, _ := it["sel"].(string)
		f, _ := it["fp"].(string)
		e.Items = append(e.Items, scanItem{Role: r, Name: n, Sel: s, FP: f, CBID: cbidVal(it)})
	}
	b, _ := json.Marshal(e)
	_ = os.MkdirAll(sessionDir(session), 0o755)
	_ = os.WriteFile(scanCachePath(session), b, 0o644)
}

func scanCacheLookup(session string, ref int) (string, string, string, int64, bool) {
	b, err := os.ReadFile(scanCachePath(session))
	if err != nil {
		return "", "", "", 0, false
	}
	var e struct {
		Items []scanItem `json:"items"`
	}
	if json.Unmarshal(b, &e) != nil || ref < 1 || ref > len(e.Items) {
		return "", "", "", 0, false
	}
	return e.Items[ref-1].Role, e.Items[ref-1].Name, e.Items[ref-1].FP, e.Items[ref-1].CBID, true
}

func cbidVal(it map[string]any) int64 {
	switch v := it["cbid"].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	}
	return 0
}
