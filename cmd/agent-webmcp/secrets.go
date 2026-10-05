package main

import (
	"context"
	"fmt"
	"strings"
)

// Secrets backends: password managers as plugins.
//
// The CLI stores no secrets. A backend resolves a login item by name or
// id and returns credentials into process memory only; the fill
// machinery (loginfill.go) pours them in-page and forgets them. CRUD
// stays in the manager itself — there are no save/list/show/delete
// verbs for secrets.
//
// Launch backend: bitwarden (`bw` CLI, free). Future backends
// (1password via `op`, protonpass via its CLI) implement SecretBackend
// and register one line in backendFor. The `--vault` flag picks one;
// AGENT_WEBMCP_VAULT overrides the default.

// LoginCreds is one resolved login: username, password, the item's own
// URLs (for the origin check), and an opaque id for TOTP minting.
type LoginCreds struct {
	Name     string
	Username string
	Password string
	URIs     []string
	TOTPID   string
	HasTOTP  bool
}

// SecretBackend resolves logins and mints TOTP codes. Implementations
// shell out to the manager's CLI; unlock state comes from the caller's
// environment (e.g. BW_SESSION), never from flags or files here.
type SecretBackend interface {
	// Display name for errors and receipts ("bitwarden").
	Name() string
	// Status reports state for doctor; ok=false names the remedy.
	Status(ctx context.Context) (string, error)
	// GetLogin resolves one item; secrets live only in the return.
	GetLogin(ctx context.Context, name string) (*LoginCreds, error)
	// TOTP mints the current code for an item carrying a seed.
	TOTP(ctx context.Context, creds *LoginCreds) (string, error)
}

// backendFor picks the secrets backend. One registration line per
// manager; unknown names fail with the supported list.
func backendFor(name string) (SecretBackend, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "bitwarden", "bw":
		return bwBackend{}, nil
	default:
		return nil, fmt.Errorf("bad_vault: unknown backend %q (supported: bitwarden)", name)
	}
}
