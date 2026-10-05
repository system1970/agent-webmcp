package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Bitwarden backend: secrets live in `bw`, never here. Unlock state
// comes from the caller's BW_SESSION; CRUD stays in Bitwarden.

type bwBackend struct{}

func (bwBackend) Name() string { return "bitwarden" }

type bwURI struct {
	URI string `json:"uri"`
}

type bwLogin struct {
	Username string  `json:"username"`
	Password string  `json:"password"`
	URIs     []bwURI `json:"uris"`
	TOTP     string  `json:"totp"`
}

type bwItem struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Login bwLogin `json:"login"`
}

// bwRun shells out to the `bw` CLI. Stdout is parsed, stderr surfaces
// verbatim (bw errors carry no secrets).
func bwRun(ctx context.Context, args ...string) ([]byte, error) {
	bin, err := exec.LookPath("bw")
	if err != nil {
		return nil, fmt.Errorf("no_bw: install @bitwarden/cli and log in (bw login --apikey, bw unlock)")
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Env = os.Environ()
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			return nil, fmt.Errorf("bw_failed: %s", strings.TrimSpace(string(ee.Stderr)))
		}
		return nil, fmt.Errorf("bw_failed: %v", err)
	}
	return out, nil
}

func (bwBackend) Status(ctx context.Context) (string, error) {
	out, err := bwRun(ctx, "status")
	if err != nil {
		return "", err
	}
	var st struct {
		Status string `json:"status"`
	}
	if json.Unmarshal(out, &st) != nil {
		return "", fmt.Errorf("bw_failed: unreadable status")
	}
	if st.Status != "unlocked" {
		return "", fmt.Errorf("bw_locked: unlock first (bw unlock --passwordenv BW_PASSWORD, export BW_SESSION)")
	}
	items, err := bwRun(ctx, "list", "items")
	if err != nil {
		return "unlocked", nil
	}
	var list []any
	if json.Unmarshal(items, &list) != nil {
		return "unlocked", nil
	}
	return fmt.Sprintf("unlocked, %d items", len(list)), nil
}

func (bwBackend) GetLogin(ctx context.Context, name string) (*LoginCreds, error) {
	out, err := bwRun(ctx, "list", "items", "--search", name)
	if err != nil {
		return nil, err
	}
	var items []bwItem
	if err := json.Unmarshal(out, &items); err != nil || len(items) == 0 {
		return nil, fmt.Errorf("not_found: no Bitwarden item %q", name)
	}
	best := &items[0]
	for i := range items {
		if items[i].ID == name || strings.EqualFold(items[i].Name, name) {
			best = &items[i]
			break
		}
	}
	full, err := bwRun(ctx, "get", "item", best.ID)
	if err != nil {
		return nil, err
	}
	var it bwItem
	if err := json.Unmarshal(full, &it); err != nil {
		return nil, fmt.Errorf("bw_failed: unreadable item %q", best.ID)
	}
	creds := &LoginCreds{
		Name: it.Name, Username: it.Login.Username, Password: it.Login.Password,
		TOTPID: it.ID, HasTOTP: it.Login.TOTP != "",
	}
	for _, u := range it.Login.URIs {
		creds.URIs = append(creds.URIs, u.URI)
	}
	return creds, nil
}

func (bwBackend) TOTP(ctx context.Context, creds *LoginCreds) (string, error) {
	out, err := bwRun(ctx, "get", "totp", creds.TOTPID)
	if err != nil {
		return "", err
	}
	code := strings.TrimSpace(string(out))
	if code == "" {
		return "", fmt.Errorf("no_totp: item %q has no TOTP seed", creds.Name)
	}
	return code, nil
}
