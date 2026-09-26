package main

import (
	"os"
	"strings"
	"testing"
)

const vaultTestKey = "aa"

// withVaultTestHome isolates the vault (store + key) per test. No test
// touches the real ~/.agent-webmcp.
func withVaultTestHome(t *testing.T) {
	t.Helper()
	t.Setenv("AGENT_WEBMCP_HOME", t.TempDir())
	t.Setenv("AGENT_WEBMCP_VAULT_KEY", strings.Repeat(vaultTestKey, 32))
}

func TestVaultSealOpenRoundtrip(t *testing.T) {
	withVaultTestHome(t)
	nonce, sealed, err := vaultSeal("site", "s3cret!")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if nonce == "" || sealed == "" {
		t.Fatal("seal returned empty parts")
	}
	got, err := vaultOpen("site", vaultProfile{URL: "https://x.test", Username: "u", Nonce: nonce, Sealed: sealed})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if got != "s3cret!" {
		t.Fatalf("roundtrip = %q", got)
	}
}

func TestVaultSealRandomizes(t *testing.T) {
	withVaultTestHome(t)
	_, s1, _ := vaultSeal("site", "same")
	_, s2, _ := vaultSeal("site", "same")
	if s1 == s2 {
		t.Fatal("identical seals: nonce reuse")
	}
}

func TestVaultProfileSwapFails(t *testing.T) {
	withVaultTestHome(t)
	nonce, sealed, _ := vaultSeal("a", "secret-a")
	// Associated data binds the name: opening a's entry as b must fail.
	if _, err := vaultOpen("b", vaultProfile{Nonce: nonce, Sealed: sealed}); err == nil {
		t.Fatal("cross-profile open succeeded")
	}
}

func TestVaultWrongKeyFails(t *testing.T) {
	withVaultTestHome(t)
	nonce, sealed, _ := vaultSeal("site", "s3cret!")
	t.Setenv("AGENT_WEBMCP_VAULT_KEY", strings.Repeat("bb", 32))
	if _, err := vaultOpen("site", vaultProfile{Nonce: nonce, Sealed: sealed}); err == nil {
		t.Fatal("wrong-key open succeeded")
	}
}

func TestVaultMetaOmitsSecrets(t *testing.T) {
	withVaultTestHome(t)
	nonce, sealed, _ := vaultSeal("site", "s3cret!")
	meta := vaultProfileMeta("site", vaultProfile{URL: "https://x.test", Username: "u", Nonce: nonce, Sealed: sealed})
	for k, v := range meta {
		s, _ := v.(string)
		if strings.Contains(s, "s3cret!") || strings.Contains(s, sealed) {
			t.Fatalf("secret leaked in meta[%q]", k)
		}
	}
	// The sealed blob on disk must not contain the plaintext either.
	raw, _ := os.ReadFile(vaultPath())
	_ = raw
	vf, _ := vaultLoad()
	vf.Profiles["site"] = vaultProfile{URL: "u", Username: "u", Nonce: nonce, Sealed: sealed}
	if err := vaultSave(vf); err != nil {
		t.Fatalf("save: %v", err)
	}
	disk, _ := os.ReadFile(vaultPath())
	if strings.Contains(string(disk), "s3cret!") {
		t.Fatal("plaintext on disk")
	}
}

func TestVaultCheckName(t *testing.T) {
	for _, good := range []string{"github", "my-app", "test_123"} {
		if err := vaultCheckName(good); err != nil {
			t.Fatalf("%q rejected: %v", good, err)
		}
	}
	for _, bad := range []string{"", "has space", "../evil", "foo/bar"} {
		if err := vaultCheckName(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}
