package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Login fill machinery: backend-agnostic. Credentials arrive from a
// SecretBackend, are poured in-page, and are forgotten. Receipts,
// history, and logs carry metadata, never values.
//
// Two guards hold for every backend: the origin check (secrets pour
// only into the navigated host, corroborated by the item's own URIs)
// and field binding (the filled nodes must still hold the values at
// submit time).

// loginFillJS finds the login fields, sets them with native setters,
// and verifies in-page. Values never leave the page: status flags
// only, never contents. Submit fires only when bound.
const loginFillJS = `((u, p, submit) => {
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
  const out = {userFound: false, passFound: false, userSet: false, passSet: false, submitFound: false, submitted: false, bound: false};
  const user = [...document.querySelectorAll('input')].find(e => ['text','email','url','tel',''].includes(e.type) && !e.disabled && !e.readOnly && vis(e));
  const pass = [...document.querySelectorAll('input[type="password"]')].find(e => !e.disabled && !e.readOnly && vis(e));
  if (user) { out.userFound = true; try { user.focus(); } catch (err) {} out.userSet = set(user, u); }
  if (pass) { out.passFound = true; try { pass.focus(); } catch (err) {} out.passSet = set(pass, p); }
  if (submit && out.userSet && out.passSet) {
    out.bound = document.contains(user) && document.contains(pass) &&
      user.value === u && pass.value === p &&
      (document.activeElement === user || document.activeElement === pass ||
       document.activeElement === document.body);
    if (!out.bound) { out.url = location.href; return JSON.stringify(out); }
    const form = (pass && pass.form) || (user && user.form) || null;
    const btn = form
      ? form.querySelector('input[type="submit"], button[type="submit"], button:not([type])')
      : document.querySelector('input[type="submit"], button[type="submit"]');
    if (btn && vis(btn)) { out.submitFound = true; btn.click(); out.submitted = true; }
  }
  out.url = location.href;
  return JSON.stringify(out);
})(__USER__, __PASS__, __SUBMIT__)`

// totpFillJS sets a 2FA code into an OTP-like field. Same status-only
// discipline as the password fill.
const totpFillJS = `((c) => {
  const vis = e => {
    try {
      const r = e.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    } catch (err) { return false; }
  };
  const out = {found: false, set: false, url: location.href};
  const f = [...document.querySelectorAll('input')].find(e => {
    const s = ((e.name || '') + ' ' + (e.id || '') + ' ' + (e.autocomplete || '') + ' ' + (e.placeholder || '')).toLowerCase();
    return !e.disabled && !e.readOnly && vis(e) && e.type !== 'password' &&
      (s.includes('otp') || s.includes('totp') || s.includes('2fa') || s.includes('authenticator') ||
       s.includes('verification') || s.includes('security code') || e.maxLength === 6);
  });
  if (!f) return JSON.stringify(out);
  out.found = true;
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(f, c); else f.value = c;
  } catch (err) { f.value = c; }
  f.dispatchEvent(new Event('input', {bubbles: true}));
  f.dispatchEvent(new Event('change', {bubbles: true}));
  out.set = f.value === c;
  return JSON.stringify(out);
})(__CODE__)`

type fillResult struct {
	UserFound   bool   `json:"userFound"`
	PassFound   bool   `json:"passFound"`
	UserSet     bool   `json:"userSet"`
	PassSet     bool   `json:"passSet"`
	SubmitFound bool   `json:"submitFound"`
	Submitted   bool   `json:"submitted"`
	Bound       bool   `json:"bound"`
	URL         string `json:"url"`
}

// runLoginFlow fills a login form from backend credentials: resolve,
// open, origin-check, pour, bind-check, optional TOTP. Plaintext lives
// only in this scope and is cleared before return.
func runLoginFlow(ctx context.Context, g *globals, backend SecretBackend, item, urlOverride string, submit, wantTOTP, noOpen bool) int {
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	creds, err := backend.GetLogin(ctx, item)
	if err != nil {
		return failErr("not_found", err)
	}
	targetURL := strings.TrimSpace(urlOverride)
	if targetURL != "" && !strings.Contains(targetURL, ":") {
		targetURL = withScheme(targetURL)
	}
	if targetURL == "" {
		for _, u := range creds.URIs {
			if strings.HasPrefix(u, "http") {
				targetURL = u
				break
			}
		}
	}
	if strings.TrimSpace(targetURL) == "" && !noOpen {
		return fail("usage", fmt.Sprintf("item %q has no URL (pass --url)", creds.Name))
	}
	if !noOpen {
		if _, err := openURL(ctx, g.session, targetURL, g.chrome, g.headed, g.allowed, timeout); err != nil {
			return failErr("open_failed", err)
		}
	}
	t, err := sessionTarget(g.session, timeout)
	if err != nil {
		return failErr("no_page", err)
	}
	landed := hostOfURL(t.URL)
	if !noOpen && landed != hostOfURL(targetURL) {
		return fail("origin_mismatch", fmt.Sprintf("landed %s, expected %s (not filling)", landed, hostOfURL(targetURL)))
	}
	allowed := len(creds.URIs) == 0
	for _, u := range creds.URIs {
		if h := hostOfURL(u); h != "" && (h == landed || strings.HasSuffix(landed, "."+h)) {
			allowed = true
			break
		}
	}
	if !allowed {
		return fail("origin_mismatch", fmt.Sprintf("%s is not among item %q URIs (not filling)", landed, creds.Name))
	}
	ub, _ := json.Marshal(creds.Username)
	pb, _ := json.Marshal(creds.Password)
	creds.Password = ""
	sub := "false"
	if submit {
		sub = "true"
	}
	expr := strings.ReplaceAll(loginFillJS, "__USER__", string(ub))
	expr = strings.ReplaceAll(expr, "__PASS__", string(pb))
	expr = strings.ReplaceAll(expr, "__SUBMIT__", sub)
	out, err := evalScript(ctx, t.WebSocketDebuggerURL, expr, timeout)
	if err != nil {
		return failErr("act_failed", err)
	}
	var r fillResult
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		return failErr("act_failed", err)
	}
	if submit && !r.Bound {
		return fail("field_moved", "login fields changed mid-fill (not submitted)")
	}
	if submit && r.Submitted {
		time.Sleep(1500 * time.Millisecond)
		if nt, terr := sessionTarget(g.session, timeout); terr == nil {
			r.URL = nt.URL
		}
	}
	totpSet := false
	if wantTOTP {
		code, terr := backend.TOTP(ctx, creds)
		if terr != nil {
			return failErr("no_totp", terr)
		}
		cb, _ := json.Marshal(code)
		code = ""
		tout, terr := evalScript(ctx, t.WebSocketDebuggerURL, strings.ReplaceAll(totpFillJS, "__CODE__", string(cb)), timeout)
		if terr == nil {
			var tr struct {
				Found bool `json:"found"`
				Set   bool `json:"set"`
			}
			if json.Unmarshal([]byte(tout), &tr) == nil {
				totpSet = tr.Set
			}
		}
	}
	okFill := r.UserSet && r.PassSet
	op := strings.ToUpper(backend.Name()) + "_LOGIN"
	appendExecuted(g.session, "", map[string]any{
		"operation": op, "target": creds.Name,
		"user_set": r.UserSet, "pass_set": r.PassSet, "submitted": r.Submitted, "totp_set": totpSet,
	})
	receipt := map[string]any{
		"operation": op, "target": creds.Name, "executed": okFill,
		"user_set": r.UserSet, "pass_set": r.PassSet, "bound": r.Bound,
		"submit_found": r.SubmitFound, "submitted": r.Submitted,
		"totp_set": totpSet, "url": r.URL,
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
	fmt.Printf("%s login %q filled (user+pass verified in-page%s%s)\n", backend.Name(), creds.Name,
		map[bool]string{true: ", submitted", false: ""}[r.Submitted],
		map[bool]string{true: ", totp set", false: ""}[totpSet])
	return 0
}
