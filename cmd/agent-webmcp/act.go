package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"time"
)

// act: execute a decision against a freshness check. Guards compare
// meaning + identity (no geometry); geometry resolves just before input
// with hit-testing. Stale -> re-decide, never force. Shared by the
// split verbs and the fused tick.

const resolveJS = `(node => {
  const e = window.__jevFast && window.__jevFast.nodes.get(node);
  if (!e || !e.isConnected) return JSON.stringify({error:'detached'});
  if (e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')) return JSON.stringify({error:'disabled'});
  const test = () => {
    const r = e.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
    if (!r.width || !r.height) return {error:'hidden'};
    if (x<0 || y<0 || x>=innerWidth || y>=innerHeight) return {error:'outside viewport'};
    try {
      if (!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return {error:'hidden'};
    } catch(err) { return {error:'hidden'}; }
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit!==e && !e.contains(hit))) return {error:'occluded'};
    return {x, y};
  };
  // Geometry resolves just before input: scroll first, measure second.
  // Sticky headers/banners occlude center clicks; retry at offsets.
  try { e.scrollIntoView({block:'center'}); } catch(err) {}
  let r = test();
  if (r.error === 'occluded' || r.error === 'outside viewport') {
    window.scrollBy(0, -140); r = test();
  }
  if (r.error === 'occluded' || r.error === 'outside viewport') {
    try { e.scrollIntoView({block:'start'}); } catch(err) {}
    window.scrollBy(0, 120); r = test();
  }
  return JSON.stringify(r);
})(__NODE__)`

// resolveKeyJS re-registers a replaced node under a fresh identity.
// Hydrating widgets swap nodes mid-loop; stable keys (id -> href ->
// placeholder -> name -> label text) survive the swap. Label text is
// the last resort (buttons rarely carry the other keys) and matches
// normalized visible text. Returns the node id, or 0.
const resolveKeyJS = `((node, key) => {
  const cache = window.__jevFast;
  if (!cache) return 0;
  let e = cache.nodes.get(node);
  if (e && e.isConnected) return node;
  const vis = x => { try { return x.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}); } catch(err){ return false; } };
  const ok = x => x && x.isConnected && vis(x);
  const norm = x => ((x.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60));
  if (key.fid) { const c = document.getElementById(key.fid); if (ok(c)) e = c; }
  if (!e && key.href) {
    try {
      const abs = new URL(key.href, location.href).href;
      e = [...document.querySelectorAll('a[href]')].find(x => { try { return x.href === abs && ok(x); } catch(err){ return false; } });
    } catch(err){}
  }
  if (!e && key.ph) e = [...document.querySelectorAll('input,textarea')].find(x => (x.placeholder||'') === key.ph && ok(x));
  if (!e && key.nm) e = [...document.querySelectorAll('input,textarea,select')].find(x => (x.name||'') === key.nm && ok(x));
  if (!e && key.lbl) e = [...document.querySelectorAll('button,a,[role="button"]')].find(x => norm(x) === key.lbl && ok(x));
  if (!e) return 0;
  if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
  const id = cache.ids.get(e); cache.nodes.set(id, e); return id;
})(__NODE__, __KEY__)`

// domSetJS sets a field value in-page with the native setter (so
// framework-controlled inputs observe the change) and fires input.
// Fallback when synthetic Input.insertText stalls; the caller verifies
// the resulting value matches the requested text.
const domSetJS = `(node => {
  const cache = window.__jevFast;
  const e = cache && cache.nodes.get(node);
  if (!e || !e.isConnected || !('value' in e)) return JSON.stringify({error:'detached'});
  try { e.focus(); } catch(err) {}
  const v = TEXT;
  try {
    const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(e, v); else e.value = v;
  } catch(err) { e.value = v; }
  e.dispatchEvent(new Event('input', {bubbles:true}));
  return JSON.stringify({ok:true, value: String(e.value)});
})(__NODE__)`

// settleJS waits for useful state after input: combobox fills wait up to
// 200ms for visible options, everything else gets two frames / 50ms.
// Read-only; runs after execution is logged.
const settleJS = `(isCombo => new Promise(resolve => {
  let frames = 0, stopped = false;
  const finish = () => { if (!stopped) { stopped = true; resolve('settled'); } };
  setTimeout(finish, isCombo ? 200 : 50);
  const ready = () => {
    if (stopped) return;
    if (!isCombo || [...document.querySelectorAll('[role="option"]')].some(e => {
      try {
        const r = e.getBoundingClientRect();
        return r.width && r.height && r.bottom > 0 && r.top < innerHeight &&
          e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
      } catch(err) { return false; }
    })) {
      if (!isCombo || ++frames >= 1) { finish(); return; }
    }
    if (++frames >= 2 && !isCombo) finish();
    else requestAnimationFrame(ready);
  };
  requestAnimationFrame(ready);
}))(__COMBO__)`

func readHistory(session string, n int, run string) []map[string]any {
	b, err := os.ReadFile(decisionsPath(session))
	if err != nil {
		return nil
	}
	var out []map[string]any
	for _, ln := range strings.Split(string(b), "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		var m map[string]any
		if json.Unmarshal([]byte(ln), &m) == nil {
			// Run-scoped reads see only their own run: last night's
			// success must not read as this attempt's evidence.
			// run=="" (split verbs) keeps the full session history.
			if run != "" {
				if r, _ := m["run"].(string); r != run {
					continue
				}
			}
			out = append(out, m)
		}
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return out
}

func appendExecuted(session, run string, entry map[string]any) {
	entry["kind"] = "executed"
	if run != "" {
		entry["run"] = run
	}
	b, _ := json.Marshal(entry)
	f, err := os.OpenFile(decisionsPath(session), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

func toolSchema(tools []WebMCPTool, name string) map[string]any {
	for _, tl := range tools {
		if tl.Name == name {
			return tl.InputSchema
		}
	}
	return nil
}

// resolveNodeByKey re-registers a replaced node under a fresh identity.
// Returns the new node id, or an error when no stable key matches.
func resolveNodeByKey(ctx context.Context, wsURL string, node int, a *snapAction, timeout time.Duration) (int, error) {
	if a.FID == "" && a.Href == "" && a.PH == "" && a.NM == "" && a.Label == "" {
		return 0, fmt.Errorf("no stable key for target %s", a.ID)
	}
	kb, _ := json.Marshal(map[string]string{"fid": a.FID, "href": a.Href, "ph": a.PH, "nm": a.NM, "lbl": a.Label})
	expr := strings.ReplaceAll(resolveKeyJS, "__NODE__", fmt.Sprintf("%d", node))
	expr = strings.ReplaceAll(expr, "__KEY__", string(kb))
	out, err := evalScript(ctx, wsURL, expr, timeout)
	if err != nil {
		return 0, err
	}
	var id int
	if err := json.Unmarshal([]byte(out), &id); err != nil || id <= 0 {
		return 0, fmt.Errorf("key resolution found no live node for %s", a.ID)
	}
	return id, nil
}

// readValueJS reads a field's live value for post-input verification.
// The insertText path confirms what landed; mismatch falls back to the
// verifying domSetText, then stale. (Stagehand's fill read-back.)
const readValueJS = `(node => {
  try {
    const e = window.__jevFast && window.__jevFast.nodes.get(node);
    return JSON.stringify({value: e && 'value' in e ? e.value : null});
  } catch(err) { return JSON.stringify({value: null}); }
})(__NODE__)`

// verifyFieldValue confirms the live field value matches the requested
// text after synthetic input.
func verifyFieldValue(ctx context.Context, wsURL string, node int, text string, timeout time.Duration) error {
	expr := strings.ReplaceAll(readValueJS, "__NODE__", fmt.Sprintf("%d", node))
	out, err := evalScript(ctx, wsURL, expr, timeout)
	if err != nil {
		return err
	}
	var r struct {
		Value *string `json:"value"`
	}
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		return err
	}
	if r.Value == nil || !valuesEquivalent(text, *r.Value) {
		got := "<unreadable>"
		if r.Value != nil {
			got = *r.Value
		}
		return fmt.Errorf("insertText mismatch (want %q, live %q)", text, got)
	}
	return nil
}

// valuesEquivalent compares requested vs live field values through the
// normalizations sites routinely apply on input (strip scheme, trailing
// slash, case, surrounding space). Byte-identity would fail every
// normalizing field forever — the site accepting and transforming the
// input IS success. Intent, not bytes.
func valuesEquivalent(want, got string) bool {
	if want == got {
		return true
	}
	norm := func(s string) string {
		s = strings.TrimSpace(s)
		l := strings.ToLower(s)
		for _, p := range []string{"https://", "http://"} {
			if strings.HasPrefix(l, p) {
				s = s[len(p):]
				break
			}
		}
		return strings.ToLower(strings.TrimRight(s, "/"))
	}
	return norm(want) == norm(got)
}

// domSetText sets a field value in-page (native setter + input event).
// Fallback when synthetic Input.insertText stalls; verifies the value.
func domSetText(ctx context.Context, wsURL string, node int, text string, timeout time.Duration) error {
	vb, _ := json.Marshal(text)
	expr := strings.ReplaceAll(domSetJS, "__NODE__", fmt.Sprintf("%d", node))
	expr = strings.ReplaceAll(expr, "TEXT", string(vb))
	out, err := evalScript(ctx, wsURL, expr, timeout)
	if err != nil {
		return err
	}
	var r struct {
		OK    bool   `json:"ok"`
		Value string `json:"value"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		return err
	}
	if !r.OK {
		return fmt.Errorf("domset: %s", r.Error)
	}
	if !valuesEquivalent(text, r.Value) {
		return fmt.Errorf("domset mismatch (re-decide)")
	}
	return nil
}

func hasRequired(schema map[string]any) bool {
	if schema == nil {
		return false
	}
	req, ok := schema["required"].([]any)
	return ok && len(req) > 0
}

func guardsEqual(a, b []any) bool {
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return string(ab) == string(bb)
}

func loadSaved(session string) (goal string, d *decision, snap *snapshot, tools []WebMCPTool, err error) {
	b, err := os.ReadFile(snapshotPath(session))
	if err != nil {
		return "", nil, nil, nil, fmt.Errorf("no saved decision (run: decide --goal)")
	}
	var saved struct {
		Goal     string       `json:"goal"`
		Decision *decision    `json:"decision"`
		Snapshot *snapshot    `json:"snapshot"`
		Tools    []WebMCPTool `json:"tools"`
	}
	if err := json.Unmarshal(b, &saved); err != nil {
		return "", nil, nil, nil, err
	}
	return saved.Goal, saved.Decision, saved.Snapshot, saved.Tools, nil
}

func actCmd(ctx context.Context, g *globals, rest []string) int {
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	goal, d, saved, tools, err := loadSaved(g.session)
	if err != nil {
		return failErr("no_decision", err)
	}
	if d == nil || saved == nil {
		return fail("no_decision", "saved decision incomplete (re-decide)")
	}
	text, params := g.text, g.params
	receipt, code, err := actExecute(ctx, g.session, goal, d, saved, tools, timeout, text, params, map[string]string{}, "")
	if err != nil {
		return failErr(code, err)
	}
	// Consume once: a saved decision executes at most once. A retry
	// cannot double-click; it must re-decide. (tick is unaffected:
	// it decides fresh every step.)
	_ = os.Remove(snapshotPath(g.session))
	if g.json {
		ok(receipt)
		return 0
	}
	fmt.Printf("%s %s executed=%v\n", receipt["operation"], receipt["target"], receipt["executed"])
	return 0
}

// actExecute runs one decision. Text/params come from the calling agent
// (flags), never generated: the agent holding the goal is the text model.
// reuse carries pending text across stale retries within a tick.
func actExecute(ctx context.Context, session, goal string, d *decision, saved *snapshot, tools []WebMCPTool, timeout time.Duration, text, params string, reuse map[string]string, run string) (map[string]any, string, error) {
	fail := func(code string, err error) (map[string]any, string, error) {
		return nil, code, err
	}
	t, err := sessionTarget(session, timeout)
	if err != nil {
		return fail("no_page", err)
	}
	switch d.Operation {
	case "DONE", "BLOCKED":
		// Terminal claims need a fresh page: a DONE decided on stale
		// state is not evidence.
		freshSnap, _, err := captureSnapshot(ctx, session, timeout)
		if err != nil {
			return fail("observe_failed", err)
		}
		if fingerprintSnap(saved) != fingerprintSnap(freshSnap) {
			return fail("stale", fmt.Errorf("page changed since decision (re-decide)"))
		}
		return map[string]any{"operation": d.Operation, "target": "", "executed": false}, "", nil
	case "WAIT":
		time.Sleep(100 * time.Millisecond)
		appendExecuted(session, run, map[string]any{"operation": "WAIT", "target": ""})
		return map[string]any{"operation": "WAIT", "target": "", "executed": true}, "", nil
	case "INVOKE":
		paramsJSON := strings.TrimSpace(params)
		if paramsJSON == "" {
			paramsJSON = "{}"
		}
		if schema := toolSchema(tools, d.Target); hasRequired(schema) {
			have, err := parseParams(paramsJSON)
			if err != nil || have == nil {
				return fail("args_needed", fmt.Errorf("tool %s needs params (agent supplies --params)", d.Target))
			}
			if req, ok := schema["required"].([]any); ok {
				for _, r := range req {
					if name, ok := r.(string); ok {
						if _, ok := have[name]; !ok {
							return fail("args_needed", fmt.Errorf("tool %s missing required %q (agent supplies --params)", d.Target, name))
						}
					}
				}
			}
			paramsJSON = mustJSON(have)
		}
		raw, err := invokeWebMCP(ctx, t.WebSocketDebuggerURL, d.Target, paramsJSON, "", timeout)
		if err != nil {
			return fail("invoke_failed", err)
		}
		var val any = string(raw)
		var js any
		if json.Unmarshal(raw, &js) == nil {
			val = js
		}
		appendExecuted(session, run, map[string]any{"operation": "INVOKE", "target": d.Target})
		return map[string]any{"operation": "INVOKE", "target": d.Target, "executed": true, "result": val}, "", nil
	}
	var action *snapAction
	for i := range saved.Actions {
		if saved.Actions[i].ID == d.Target {
			action = &saved.Actions[i]
			break
		}
	}
	if action == nil {
		return fail("stale", fmt.Errorf("target %s not in decided snapshot (re-decide)", d.Target))
	}
	if action.Kind == "scroll" {
		c, err := dialCDP(ctx, t.WebSocketDebuggerURL)
		if err != nil {
			return fail("act_failed", err)
		}
		defer c.Close()
		delta := 560.0
		if strings.HasPrefix(action.ID, "scroll_up") {
			delta = -560.0
		}
		sctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		if _, err := c.Call(sctx, "Input.dispatchMouseEvent", map[string]any{
			"type": "mouseWheel", "x": 700, "y": 700, "deltaX": 0, "deltaY": delta,
		}); err != nil {
			return fail("act_failed", err)
		}
		appendExecuted(session, run, map[string]any{"operation": d.Operation, "target": d.Target})
		return map[string]any{"operation": d.Operation, "target": d.Target, "executed": true}, "", nil
	}
	// Text is agent-supplied (flags); pending text survives a stale retry.
	if action.Kind == "fill" {
		if strings.TrimSpace(text) == "" {
			if cached, ok := reuse["fill:"+action.ID]; ok {
				text = cached
			} else {
				return fail("text_needed", fmt.Errorf("field %q needs text (agent supplies --text)", action.Label))
			}
		} else {
			reuse["fill:"+action.ID] = text
		}
	}
	freshSnap, _, err := captureSnapshot(ctx, session, timeout)
	if err != nil {
		return fail("observe_failed", err)
	}
	fpSaved := fingerprintSnap(saved)
	fpFresh := fingerprintSnap(freshSnap)
	nodeKey := fmt.Sprintf("%d", action.Node)
	gsaved, okS := saved.Guards[nodeKey]
	gfresh, okF := freshSnap.Guards[nodeKey]
	if action.Kind != "select" && (fpSaved != fpFresh || !okS || !okF || !guardsEqual(gsaved, gfresh)) {
		return fail("stale", fmt.Errorf("page changed since decision (re-decide)"))
	}
	if action.Kind == "select" {
		return actSelect(ctx, session, t.WebSocketDebuggerURL, action, timeout, run)
	}
	expr := strings.ReplaceAll(resolveJS, "__NODE__", fmt.Sprintf("%d", action.Node))
	out, err := evalScript(ctx, t.WebSocketDebuggerURL, expr, timeout)
	if err != nil {
		return fail("act_failed", err)
	}
	var pt struct {
		X     float64 `json:"x"`
		Y     float64 `json:"y"`
		Error string  `json:"error"`
	}
	if err := json.Unmarshal([]byte(out), &pt); err != nil {
		return fail("act_failed", err)
	}
	if pt.Error == "detached" {
		// The observed node was replaced (hydrating widget). Re-resolve
		// by stable key once before giving up to a re-decide.
		if id, kerr := resolveNodeByKey(ctx, t.WebSocketDebuggerURL, action.Node, action, timeout); kerr == nil {
			action.Node = id
			expr := strings.ReplaceAll(resolveJS, "__NODE__", fmt.Sprintf("%d", action.Node))
			if out2, err2 := evalScript(ctx, t.WebSocketDebuggerURL, expr, timeout); err2 == nil {
				out = out2
				if err := json.Unmarshal([]byte(out), &pt); err != nil {
					return fail("act_failed", err)
				}
			}
		}
	}
	if pt.Error != "" {
		return fail("stale", fmt.Errorf("target %s (re-decide)", pt.Error))
	}
	c, err := dialCDP(ctx, t.WebSocketDebuggerURL)
	if err != nil {
		return fail("act_failed", err)
	}
	defer c.Close()
	callInput := func(method string, params map[string]any) error {
		ectx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		_, err := c.Call(ectx, method, params)
		return err
	}
	for _, ev := range []string{"mouseMoved", "mousePressed", "mouseReleased"} {
		params := map[string]any{"type": ev, "x": pt.X, "y": pt.Y}
		if ev != "mouseMoved" {
			params["button"] = "left"
			params["clickCount"] = 1
		}
		if err := callInput("Input.dispatchMouseEvent", params); err != nil {
			return fail("act_failed", err)
		}
	}
	if action.Kind == "fill" {
		mod := 2
		if runtime.GOOS == "darwin" {
			mod = 4
		}
		for _, ev := range []string{"keyDown", "keyUp"} {
			if err := callInput("Input.dispatchKeyEvent", map[string]any{
				"type": ev, "key": "a", "code": "KeyA",
				"modifiers": mod, "commands": []string{"selectAll"},
			}); err != nil {
				return fail("act_failed", err)
			}
		}
		if err := callInput("Input.insertText", map[string]any{"text": text}); err != nil {
			// Synthetic input stalled (node replaced mid-sequence):
			// set in-page with the native setter and verify the value.
			if derr := domSetText(ctx, t.WebSocketDebuggerURL, action.Node, text, timeout); derr != nil {
				return fail("stale", derr)
			}
		} else if verr := verifyFieldValue(ctx, t.WebSocketDebuggerURL, action.Node, text, timeout); verr != nil {
			// Landed text differs from requested: same fallback, then stale.
			if derr := domSetText(ctx, t.WebSocketDebuggerURL, action.Node, text, timeout); derr != nil {
				return fail("stale", derr)
			}
		}
	}
	combo := action.Role == "combobox"
	settleExpr := strings.ReplaceAll(settleJS, "__COMBO__", "false")
	if combo {
		settleExpr = strings.ReplaceAll(settleJS, "__COMBO__", "true")
	}
	sctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_, _ = evalScript(sctx, t.WebSocketDebuggerURL, settleExpr, 5*time.Second)
	entry := map[string]any{
		"operation": d.Operation, "target": d.Target, "confidence": d.Confidence,
		"x": pt.X, "y": pt.Y,
	}
	if text != "" {
		entry["text"] = text
	}
	appendExecuted(session, run, entry)
	receipt := map[string]any{"operation": d.Operation, "target": d.Target, "executed": true, "x": pt.X, "y": pt.Y}
	if text != "" {
		receipt["text"] = text
	}
	return receipt, "", nil
}

// actSelect sets a native dropdown by observed option value. Uncertain
// mutation results stop instead of retrying as stale reads.
func actSelect(ctx context.Context, session, wsURL string, action *snapAction, timeout time.Duration, run string) (map[string]any, string, error) {
	expr := `(node => {
  const e = window.__jevFast && window.__jevFast.nodes.get(node);
  if (!e || !e.isConnected) return JSON.stringify({error:'detached'});
  if (e.tagName !== 'SELECT') return JSON.stringify({error:'not a dropdown'});
  const opt = [...e.options].find(o => o.value === VALUE && !o.disabled && !o.closest('optgroup[disabled]'));
  if (!opt) return JSON.stringify({error:'no such option'});
  e.value = VALUE;
  e.dispatchEvent(new Event('input', {bubbles:true}));
  e.dispatchEvent(new Event('change', {bubbles:true}));
  return JSON.stringify({ok:true});
})(__NODE__)`
	vb, _ := json.Marshal(action.Value)
	expr = strings.ReplaceAll(strings.ReplaceAll(expr, "__NODE__", fmt.Sprintf("%d", action.Node)), "VALUE", string(vb))
	out, err := evalScript(ctx, wsURL, expr, timeout)
	if err != nil {
		return nil, "act_failed", err
	}
	var r struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		return nil, "act_failed", err
	}
	if !r.OK {
		return nil, "select_unconfirmed", fmt.Errorf("dropdown execution was not confirmed: %s", r.Error)
	}
	appendExecuted(session, run, map[string]any{"operation": "SELECT", "target": action.ID})
	return map[string]any{"operation": "SELECT", "target": action.ID, "executed": true}, "", nil
}
