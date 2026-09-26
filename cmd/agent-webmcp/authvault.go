package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Local encrypted auth vault. Modelled on agent-browser's vault with one
// harder rule: secrets never cross into model state, receipts, or logs —
// the fill path decrypts in-process and records only "[vault]".
//
// Layout (0600, machine-local, never in a repo):
// ~/.agent-webmcp/vault.json  — {version, profiles: {name: {url, username, nonce, sealed}}}
// ~/.agent-webmcp/.vault-key   — 32 random bytes, generated once.
// AGENT_WEBMCP_VAULT_KEY (64 hex chars) overrides the key file when set.

const vaultVersion = 1

type vaultProfile struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Nonce    string `json:"nonce"`
	Sealed   string `json:"sealed"`
}

type vaultFile struct {
	Version  int                     `json:"version"`
	Profiles map[string]vaultProfile `json:"profiles"`
}

func vaultDir() string {
	if v := os.Getenv("AGENT_WEBMCP_HOME"); v != "" {
		return v
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return filepath.Join(h, ".agent-webmcp")
	}
	return ".agent-webmcp"
}

func vaultPath() string    { return filepath.Join(vaultDir(), "vault.json") }
func vaultKeyPath() string { return filepath.Join(vaultDir(), ".vault-key") }

// vaultKey loads or generates the 32-byte vault key. Generation happens
// once, file 0600. Env override takes precedence when valid.
func vaultKey() ([]byte, error) {
	if v := os.Getenv("AGENT_WEBMCP_VAULT_KEY"); v != "" {
		raw, err := hex.DecodeString(v)
		if err != nil || len(raw) != 32 {
			return nil, fmt.Errorf("bad AGENT_WEBMCP_VAULT_KEY: want 64 hex chars")
		}
		return raw, nil
	}
	p := vaultKeyPath()
	if raw, err := os.ReadFile(p); err == nil {
		if len(raw) == 32 {
			return raw, nil
		}
		return nil, fmt.Errorf("bad vault key file (want 32 bytes)")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(vaultDir(), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(p, raw, 0o600); err != nil {
		return nil, err
	}
	return raw, nil
}

func vaultAEAD() (cipher.AEAD, error) {
	key, err := vaultKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func vaultLoad() (*vaultFile, error) {
	vf := &vaultFile{Version: vaultVersion, Profiles: map[string]vaultProfile{}}
	raw, err := os.ReadFile(vaultPath())
	if err != nil {
		if os.IsNotExist(err) {
			return vf, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(raw, vf); err != nil {
		return nil, fmt.Errorf("unreadable vault (not JSON)")
	}
	if vf.Profiles == nil {
		vf.Profiles = map[string]vaultProfile{}
	}
	return vf, nil
}

func vaultSave(vf *vaultFile) error {
	vf.Version = vaultVersion
	raw, err := json.MarshalIndent(vf, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(vaultDir(), 0o700); err != nil {
		return err
	}
	return os.WriteFile(vaultPath(), raw, 0o600)
}

// vaultSeal encrypts one secret. Nonce is random per seal; the associated
// data binds profile name so entries cannot be swapped between profiles.
func vaultSeal(name, secret string) (nonceHex, sealedHex string, err error) {
	aead, err := vaultAEAD()
	if err != nil {
		return "", "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", "", err
	}
	sealed := aead.Seal(nil, nonce, []byte(secret), []byte("vault-profile:"+name))
	return hex.EncodeToString(nonce), hex.EncodeToString(sealed), nil
}

// vaultOpen decrypts one profile secret. The plaintext lives only in the
// returned string: callers must never log, print, or store it.
func vaultOpen(name string, p vaultProfile) (string, error) {
	aead, err := vaultAEAD()
	if err != nil {
		return "", err
	}
	nonce, err := hex.DecodeString(p.Nonce)
	if err != nil {
		return "", fmt.Errorf("bad vault entry for %q", name)
	}
	sealed, err := hex.DecodeString(p.Sealed)
	if err != nil {
		return "", fmt.Errorf("bad vault entry for %q", name)
	}
	plain, err := aead.Open(nil, nonce, sealed, []byte("vault-profile:"+name))
	if err != nil {
		return "", fmt.Errorf("cannot open vault entry for %q (wrong key?)", name)
	}
	return string(plain), nil
}

// vaultProfileMeta is the safe projection: metadata only, never secrets.
func vaultProfileMeta(name string, p vaultProfile) map[string]any {
	return map[string]any{"name": name, "url": p.URL, "username": p.Username}
}

var vaultNameRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// authVaultCmd serves save/list/show/delete. Login (fill path) follows;
// its dispatch name is already reserved in authCmd.
func authVaultCmd(g *globals, rest []string) int {
	if len(rest) == 0 {
		return fail("usage", "usage: agent-webmcp auth <save|list|show|delete> ...")
	}
	switch rest[0] {
	case "save":
		return authVaultSaveCmd(g, rest[1:])
	case "list":
		return authVaultListCmd(g)
	case "show":
		return authVaultShowCmd(g, rest[1:])
	case "delete":
		return authVaultDeleteCmd(g, rest[1:])
	default:
		return fail("usage", "usage: agent-webmcp auth <save|list|show|delete> ...")
	}
}

// vaultFillJS finds the login fields, sets them with native setters, and
// verifies in-page. Values never leave the page: it returns status flags
// only, never field contents.
const vaultFillJS = `((u, p, submit) => {
  const vis = e => {
    try {
      const r = e.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true});
    } catch (err) { return false; }
  };
  const set = (e, v) => {
    try {
      const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(e, v); else e.value = v;
    } catch (err) { e.value = v; }
    e.dispatchEvent(new Event('input', {bubbles: true}));
    e.dispatchEvent(new Event('change', {bubbles: true}));
    return e.value === v;
  };
  const out = {userFound: false, passFound: false, userSet: false, passSet: false, submitFound: false, submitted: false};
  const user = [...document.querySelectorAll('input')].find(e => ['text','email','url','tel',''].includes(e.type) && !e.disabled && !e.readOnly && vis(e));
  const pass = [...document.querySelectorAll('input[type="password"]')].find(e => !e.disabled && !e.readOnly && vis(e));
  if (user) { out.userFound = true; try { user.focus(); } catch (err) {} out.userSet = set(user, u); }
  if (pass) { out.passFound = true; try { pass.focus(); } catch (err) {} out.passSet = set(pass, p); }
  if (submit && out.userSet && out.passSet) {
    const form = (pass && pass.form) || (user && user.form) || null;
    const btn = form
      ? form.querySelector('input[type="submit"], button[type="submit"], button:not([type])')
      : document.querySelector('input[type="submit"], button[type="submit"]');
    if (btn && vis(btn)) { out.submitFound = true; btn.click(); out.submitted = true; }
  }
  out.url = location.href;
  return JSON.stringify(out);
})(__USER__, __PASS__, __SUBMIT__)`

// authVaultLoginCmd opens the profile URL and fills the login form from
// the vault. Secrets travel only inside page JS and the sealed store:
// receipts, history, and logs carry metadata, never values.
func authVaultLoginCmd(ctx context.Context, g *globals, rest []string) int {
	var name string
	for _, a := range rest {
		if !strings.HasPrefix(a, "-") {
			name = a
			break
		}
	}
	if name == "" {
		return fail("usage", "usage: agent-webmcp auth login <name> [--session NAME] [--url URL] [--submit] [--json]")
	}
	vf, err := vaultLoad()
	if err != nil {
		return failErr("vault_failed", err)
	}
	p, found := vf.Profiles[name]
	if !found {
		return fail("not_found", fmt.Sprintf("vault profile %q not found", name))
	}
	secret, err := vaultOpen(name, p)
	if err != nil {
		return failErr("vault_failed", err)
	}
	targetURL := p.URL
	if u, has := verbFlag(rest, "url"); has && strings.TrimSpace(u) != "" {
		u = strings.TrimSpace(u)
		if strings.Contains(u, ":") {
			targetURL = u
		} else {
			targetURL = withScheme(u)
		}
	}
	if strings.TrimSpace(targetURL) == "" {
		return fail("usage", fmt.Sprintf("profile %q has no URL (re-save with --url, or pass --url)", name))
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	if _, err := openURL(ctx, g.session, targetURL, g.chrome, g.headed, timeout); err != nil {
		return failErr("open_failed", err)
	}
	t, err := sessionTarget(g.session, timeout)
	if err != nil {
		return failErr("no_page", err)
	}
	ub, _ := json.Marshal(p.Username)
	pb, _ := json.Marshal(secret)
	secret = ""
	submit := "false"
	if hasFlag(rest, "submit") {
		submit = "true"
	}
	expr := strings.ReplaceAll(vaultFillJS, "__USER__", string(ub))
	expr = strings.ReplaceAll(expr, "__PASS__", string(pb))
	expr = strings.ReplaceAll(expr, "__SUBMIT__", submit)
	out, err := evalScript(ctx, t.WebSocketDebuggerURL, expr, timeout)
	if err != nil {
		return failErr("act_failed", err)
	}
	var r struct {
		UserFound   bool   `json:"userFound"`
		PassFound   bool   `json:"passFound"`
		UserSet     bool   `json:"userSet"`
		PassSet     bool   `json:"passSet"`
		SubmitFound bool   `json:"submitFound"`
		Submitted   bool   `json:"submitted"`
		URL         string `json:"url"`
	}
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		return failErr("act_failed", err)
	}
	if submit == "true" && r.Submitted {
		time.Sleep(1500 * time.Millisecond)
		if nt, terr := sessionTarget(g.session, timeout); terr == nil {
			r.URL = nt.URL
		}
	}
	okFill := r.UserSet && r.PassSet
	// History carries metadata only: profile name, never values.
	appendExecuted(g.session, "", map[string]any{
		"operation": "VAULT_LOGIN", "target": name,
		"user_set": r.UserSet, "pass_set": r.PassSet, "submitted": r.Submitted,
	})
	receipt := map[string]any{
		"operation": "VAULT_LOGIN", "target": name, "executed": okFill,
		"user_set": r.UserSet, "pass_set": r.PassSet,
		"submit_found": r.SubmitFound, "submitted": r.Submitted, "url": r.URL,
	}
	if !r.UserFound || !r.PassFound {
		receipt["executed"] = false
		if g.json {
			fmt.Printf("%s\n", mustJSON(map[string]any{"ok": false, "code": "no_login_form", "error": "no visible login fields", "data": receipt}))
			return 1
		}
		return fail("no_login_form", "no visible login fields")
	}
	if !okFill {
		receipt["executed"] = false
		if g.json {
			fmt.Printf("%s\n", mustJSON(map[string]any{"ok": false, "code": "act_failed", "error": "fill unverified", "data": receipt}))
			return 1
		}
		return fail("act_failed", "fill unverified")
	}
	if g.json {
		ok(receipt)
		return 0
	}
	fmt.Printf("vault login %q filled (user+pass verified in-page%s)\n", name,
		map[bool]string{true: ", submitted", false: ""}[r.Submitted])
	return 0
}

func vaultCheckName(name string) error {
	if !vaultNameRe.MatchString(name) {
		return fmt.Errorf("bad profile name %q (want ^[A-Za-z0-9_-]+$)", name)
	}
	return nil
}

func authVaultSaveCmd(g *globals, rest []string) int {
	url, _ := verbFlag(rest, "url")
	username, _ := verbFlag(rest, "username")
	if strings.TrimSpace(url) == "" || strings.TrimSpace(username) == "" {
		return fail("usage", "usage: agent-webmcp auth save --url URL --username NAME --password-stdin [--name PROFILE]")
	}
	name, _ := verbFlag(rest, "name")
	if name == "" {
		name = username
	}
	if err := vaultCheckName(name); err != nil {
		return fail("bad_name", err.Error())
	}
	var secret string
	if hasFlag(rest, "password-stdin") {
		raw, err := io.ReadAll(os.Stdin)
		if err != nil {
			return fail("vault_failed", err.Error())
		}
		secret = strings.TrimRight(string(raw), "\r\n")
	} else if pw, ok := verbFlag(rest, "password"); ok {
		secret = pw
	} else {
		return fail("usage", "refusing empty secret: pass --password-stdin or --password")
	}
	if secret == "" {
		return fail("usage", "refusing empty secret: pass --password-stdin or --password")
	}
	nonceHex, sealedHex, err := vaultSeal(name, secret)
	if err != nil {
		return failErr("vault_failed", err)
	}
	vf, err := vaultLoad()
	if err != nil {
		return failErr("vault_failed", err)
	}
	vf.Profiles[name] = vaultProfile{URL: url, Username: username, Nonce: nonceHex, Sealed: sealedHex}
	if err := vaultSave(vf); err != nil {
		return failErr("vault_failed", err)
	}
	if g.json {
		ok(map[string]any{"saved": name})
		return 0
	}
	fmt.Printf("vault profile %q saved\n", name)
	return 0
}

func authVaultListCmd(g *globals) int {
	vf, err := vaultLoad()
	if err != nil {
		return failErr("vault_failed", err)
	}
	names := make([]string, 0, len(vf.Profiles))
	for n := range vf.Profiles {
		names = append(names, n)
	}
	sort.Strings(names)
	items := make([]map[string]any, 0, len(names))
	for _, n := range names {
		items = append(items, vaultProfileMeta(n, vf.Profiles[n]))
	}
	if g.json {
		ok(map[string]any{"profiles": items})
		return 0
	}
	if len(items) == 0 {
		fmt.Println("no vault profiles")
		return 0
	}
	for _, it := range items {
		fmt.Printf("%s  url=%s username=%s\n", it["name"], it["url"], it["username"])
	}
	return 0
}

func authVaultShowCmd(g *globals, rest []string) int {
	var name string
	for _, a := range rest {
		if !strings.HasPrefix(a, "-") {
			name = a
			break
		}
	}
	if name == "" {
		return fail("usage", "usage: agent-webmcp auth show <name>")
	}
	vf, err := vaultLoad()
	if err != nil {
		return failErr("vault_failed", err)
	}
	p, found := vf.Profiles[name]
	if !found {
		return fail("not_found", fmt.Sprintf("vault profile %q not found", name))
	}
	meta := vaultProfileMeta(name, p)
	meta["hasPassword"] = true
	if g.json {
		ok(map[string]any{"profile": meta})
		return 0
	}
	fmt.Printf("%s  url=%s username=%s (password sealed)\n", name, p.URL, p.Username)
	return 0
}

func authVaultDeleteCmd(g *globals, rest []string) int {
	var name string
	for _, a := range rest {
		if !strings.HasPrefix(a, "-") {
			name = a
			break
		}
	}
	if name == "" {
		return fail("usage", "usage: agent-webmcp auth delete <name>")
	}
	vf, err := vaultLoad()
	if err != nil {
		return failErr("vault_failed", err)
	}
	if _, ok := vf.Profiles[name]; !ok {
		return fail("not_found", fmt.Sprintf("vault profile %q not found", name))
	}
	delete(vf.Profiles, name)
	if err := vaultSave(vf); err != nil {
		return failErr("vault_failed", err)
	}
	if g.json {
		ok(map[string]any{"deleted": name})
		return 0
	}
	fmt.Printf("vault profile %q deleted\n", name)
	return 0
}
