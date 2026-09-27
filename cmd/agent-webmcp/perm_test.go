package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEvidenceLockedDown(t *testing.T) {
	t.Setenv("AGENT_WEBMCP_HOME", t.TempDir())
	d := &decision{Operation: "CLICK", Target: "e1", Confidence: 0.9}
	saveDecision("permtest", d, &snapshot{}, nil, "goal", "")
	for _, p := range []string{decisionsPath("permtest"), snapshotPath("permtest")} {
		fi, err := os.Stat(p)
		if err != nil {
			t.Fatalf("stat %s: %v", p, err)
		}
		if fi.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode = %o, want 600", p, fi.Mode().Perm())
		}
	}
	if fi, _ := os.Stat(filepath.Dir(decisionsPath("permtest"))); fi.Mode().Perm() != 0o700 {
		t.Fatalf("session dir mode = %o, want 700", fi.Mode().Perm())
	}
}
