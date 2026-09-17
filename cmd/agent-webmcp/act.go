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
  try {
    if (!e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return JSON.stringify({error:'hidden'});
  } catch(err) { return JSON.stringify({error:'hidden'}); }
  const r = e.getBoundingClientRect(), x = r.x+r.width/2, y = r.y+r.height/2;
  if (!r.width || !r.height || x<0 || y<0 || x>=innerWidth || y>=innerHeight)
    return JSON.stringify({error:'outside viewport'});
  const hit = document.elementFromPoint(x, y);
  if (!hit || (hit!==e && !e.contains(hit))) return JSON.stringify({error:'occluded'});
  return JSON.stringify({x, y});
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

func readHistory(session string, n int) []map[string]any {
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
			out = append(out, m)
		}
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return out
}

func appendExecuted(session string, entry map[string]any) {
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
	receipt, code, err := actExecute(ctx, g.session, goal, d, saved, tools, timeout, text, params, map[string]string{})
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
func actExecute(ctx context.Context, session, goal string, d *decision, saved *snapshot, tools []WebMCPTool, timeout time.Duration, text, params string, reuse map[string]string) (map[string]any, string, error) {
	fail := func(code string, err error) (map[string]any, string, error) {
		return nil, code, err
	}
	port, err := readPort(session)
	if err != nil {
		return fail("no_session", err)
	}
	t, err := pickPageTarget(port)
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
		appendExecuted(session, map[string]any{"operation": "WAIT", "target": ""})
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
		appendExecuted(session, map[string]any{"operation": "INVOKE", "target": d.Target})
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
		appendExecuted(session, map[string]any{"operation": d.Operation, "target": d.Target})
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
		return actSelect(ctx, session, t.WebSocketDebuggerURL, action, timeout)
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
	for _, ev := range []string{"mousePressed", "mouseReleased"} {
		if err := callInput("Input.dispatchMouseEvent", map[string]any{
			"type": ev, "x": pt.X, "y": pt.Y, "button": "left", "clickCount": 1,
		}); err != nil {
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
			return fail("act_failed", err)
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
	appendExecuted(session, entry)
	receipt := map[string]any{"operation": d.Operation, "target": d.Target, "executed": true, "x": pt.X, "y": pt.Y}
	if text != "" {
		receipt["text"] = text
	}
	return receipt, "", nil
}

// actSelect sets a native dropdown by observed option value. Uncertain
// mutation results stop instead of retrying as stale reads.
func actSelect(ctx context.Context, session, wsURL string, action *snapAction, timeout time.Duration) (map[string]any, string, error) {
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
	appendExecuted(session, map[string]any{"operation": "SELECT", "target": action.ID})
	return map[string]any{"operation": "SELECT", "target": action.ID, "executed": true}, "", nil
}
