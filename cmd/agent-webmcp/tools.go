package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// Shared page-evaluation helpers. Inspection only; actuation belongs
// to page tools (invoke) or the paid tier (act).

func normalizeHost(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	h = strings.TrimPrefix(h, "https://")
	h = strings.TrimPrefix(h, "http://")
	h = strings.TrimSuffix(h, "/")
	if i := strings.IndexByte(h, '/'); i >= 0 {
		h = h[:i]
	}
	if i := strings.IndexByte(h, ':'); i >= 0 {
		h = h[:i]
	}
	h = strings.TrimPrefix(h, "www.")
	if h == "" {
		return "*"
	}
	return h
}

func hostOfURL(u string) string {
	return normalizeHost(u)
}

// withScheme prefixes https:// onto bare hosts. Callers with special
// schemes (about:, data:) check those first and never reach here.
func withScheme(u string) string {
	if strings.Contains(u, "://") {
		return u
	}
	return "https://" + u
}

func verbFlag(args []string, name string) (string, bool) {
	for i := 0; i < len(args); i++ {
		if args[i] == "--"+name && i+1 < len(args) {
			return args[i+1], true
		}
		if strings.HasPrefix(args[i], "--"+name+"=") {
			return strings.TrimPrefix(args[i], "--"+name+"="), true
		}
	}
	return "", false
}

func readEvalArg(rest []string) (string, error) {
	if len(rest) == 0 {
		return "", fmt.Errorf("usage: agent-webmcp eval <js|@file>")
	}
	expr := strings.Join(rest, " ")
	if trimmed := strings.TrimSpace(expr); strings.HasPrefix(trimmed, "@") && !strings.Contains(trimmed, " ") {
		b, err := os.ReadFile(strings.TrimPrefix(trimmed, "@"))
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	return expr, nil
}

// evalScript runs JS in the page and awaits a by-value result.
func evalScript(ctx context.Context, wsURL, script string, timeout time.Duration) (string, error) {
	c, err := dialCDP(ctx, wsURL)
	if err != nil {
		return "", err
	}
	defer c.Close()
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	raw, err := c.Call(callCtx, "Runtime.evaluate", map[string]any{
		"expression": script, "returnByValue": true, "awaitPromise": true,
	})
	if err != nil {
		return "", err
	}
	var res struct {
		Result struct {
			Type  string          `json:"type"`
			Value json.RawMessage `json:"value"`
		} `json:"result"`
		ExceptionDetails *struct {
			Text string `json:"text"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return "", err
	}
	if res.ExceptionDetails != nil {
		return "", fmt.Errorf("js exception: %s", res.ExceptionDetails.Text)
	}
	if len(res.Result.Value) == 0 {
		return "", nil
	}
	var s string
	if json.Unmarshal(res.Result.Value, &s) == nil {
		return s, nil
	}
	return string(res.Result.Value), nil
}

// reconJS inventories visible interactive controls + gate signals.
// Machine inventories, human assigns meaning.
const reconJS = `(() => {
  var norm = function(s){ return ((s||'').replace(/\s+/g,' ').trim()); };
  var chain = function(el){ var c=[], p=el.parentElement; for (var i=0;i<4&&p;i++){ c.push((p.tagName||'?')+'.'+(((p.getAttribute&&p.getAttribute('role'))||(p.className||'')).toString().split(' ')[0]).slice(0,30)); p=p.parentElement; } return c.join('<'); };
  var SEL = 'button,a,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=textbox],[role=searchbox],[role=combobox]';
  var out = [];
  var els = document.querySelectorAll(SEL);
  for (var i=0;i<els.length && out.length<150;i++){
    var el = els[i];
    var r; try { r = el.getBoundingClientRect(); } catch(e){ continue; }
    if (!(r.width>2&&r.height>2)) continue;
    var cs; try { cs = getComputedStyle(el); } catch(e){ continue; }
    if (cs.visibility==='hidden'||cs.display==='none') continue;
    var name = norm(el.getAttribute&&el.getAttribute('aria-label')) || norm(el.innerText).split('\n')[0].slice(0,80) || norm(el.placeholder) || '';
    if (!name) continue;
    out.push({role: (el.getAttribute&&el.getAttribute('role'))||el.tagName.toLowerCase(), name: name,
      x: Math.round(r.x), y: Math.round(r.y), ctx: chain(el),
      sel: el.getAttribute&&el.getAttribute('data-testid') ? '[data-testid="'+el.getAttribute('data-testid')+'"]' : (el.id ? '#'+el.id : '')});
  }
  var gates = [];
  var html = document.documentElement.innerHTML.slice(0, 400000);
  if (/hcaptcha|cf-challenge|turnstile|recaptcha|akam\/|sensor_data/i.test(html)) gates.push('bot-defense-present');
  return JSON.stringify({url: location.href, controls: out, gates: gates});
})()`
