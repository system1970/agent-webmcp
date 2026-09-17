package main

// Jev-shaped browser verbs. observe returns the decision state directly
// (url/title/text/elements/tools/fingerprint); act executes an index from
// the last observation; decide answers operation+target via one Jev call.
// No actuation happens inside observe or decide — the constraint boundary
// is structural: decide prints, something else acts.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// observeJS returns a JSON string: page identity, capped text, and the
// visible interactable table Jev grounds against. Budgets are fixed:
// 60 elements, 3000 text chars. No filters, no scopes.
const observeJS = `(() => {
  var SEL = 'button,a,input,select,textarea,[contenteditable=true],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=listbox],[role=searchbox],[role=textbox]';
  var vis = function(el){ try { var r = el.getBoundingClientRect(); if (!(r.width > 2 && r.height > 2)) return false; var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; if (parseFloat(cs.opacity || '1') === 0) return false; return true; } catch(e){ return false; } };
  var collapse = function(s){ return (s||'').replace(/\s+/g,' ').trim(); };
  var firstLine = function(el){ try { var it = el.innerText || ''; var ls = it.split('\n'); for (var i=0;i<ls.length;i++){ var l = collapse(ls[i]); if (l) return l; } } catch(e){} return ''; };
  var label = function(el){ try {
    var g = function(k){ return el.getAttribute ? (el.getAttribute(k) || '') : ''; };
    var al = collapse(g('aria-label')); if (al) return al.slice(0,80);
    var fl = firstLine(el); if (fl) return fl.slice(0,80);
    if (el.placeholder) return collapse(el.placeholder).slice(0,80);
    if (g('title')) return collapse(g('title')).slice(0,80);
    if (el.type) return '(' + el.type + ')';
    return '(no label)';
  } catch(e){ return '(no label)'; } };
  var roleOf = function(el){ var t = (el.tagName||'').toLowerCase(); if (t==='a') return 'link'; if (t==='button') return 'button'; if (t==='select') return 'select'; if (t==='textarea') return 'textbox'; if (t==='input'){ var ty=((el.type||'text')+'').toLowerCase(); if (ty==='checkbox') return 'checkbox'; if (ty==='radio') return 'radio'; if (ty==='submit'||ty==='button') return 'button'; if (ty==='hidden') return 'hidden'; return 'textbox'; } if (el.isContentEditable) return 'textbox'; var r = el.getAttribute && el.getAttribute('role'); return ((r||t||'el')+'').toLowerCase(); };
  var out = [];
  var els = document.querySelectorAll(SEL);
  for (var i=0;i<els.length && out.length<60;i++){ var el = els[i]; if (!vis(el)) continue; var role = roleOf(el); if (role==='hidden') continue;
    var v = ''; try { v = (el.value||'').slice(0,120); } catch(e){}
    out.push({role:role, name:label(el), value:v, en:(!el.disabled)});
  }
  var text = ''; try { text = (document.body.innerText||'').slice(0,3000); } catch(e){}
  return JSON.stringify({url:location.href, title:(document.title||'').slice(0,80), text:text, elements:out});
})()`

// actJS2 grounds role+name visible-first, rechecks occlusion, then acts.
// Placeholders carry JSON-encoded strings.
const actJS2 = `(async function(){
  var ROLE=@ROLE@, NAME=@NAME@, VERB=@VERB@, TEXT=@TEXT@;
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var SEL = 'button,a,input,select,textarea,[contenteditable=true],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=listbox],[role=searchbox],[role=textbox]';
  var vis = function(el){ try { var r = el.getBoundingClientRect(); if (!(r.width > 2 && r.height > 2)) return false; var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; return true; } catch(e){ return false; } };
  var collapse = function(s){ return (s||'').replace(/\s+/g,' ').trim(); };
  var firstLine = function(el){ try { var it = el.innerText || ''; var ls = it.split('\n'); for (var i=0;i<ls.length;i++){ var l = collapse(ls[i]); if (l) return l; } } catch(e){} return ''; };
  var label = function(el){ try { var g = function(k){ return el.getAttribute ? (el.getAttribute(k) || '') : ''; }; var al = collapse(g('aria-label')); if (al) return al.slice(0,80); var fl = firstLine(el); if (fl) return fl.slice(0,80); if (el.placeholder) return collapse(el.placeholder).slice(0,80); if (el.type) return '(' + el.type + ')'; return '(no label)'; } catch(e){ return '(no label)'; } };
  var roleOf = function(el){ var t = (el.tagName||'').toLowerCase(); if (t==='a') return 'link'; if (t==='button') return 'button'; if (t==='select') return 'select'; if (t==='textarea') return 'textbox'; if (t==='input'){ var ty=((el.type||'text')+'').toLowerCase(); if (ty==='checkbox') return 'checkbox'; if (ty==='radio') return 'radio'; if (ty==='submit'||ty==='button') return 'button'; return 'textbox'; } if (el.isContentEditable) return 'textbox'; var r = el.getAttribute && el.getAttribute('role'); return ((r||t||'el')+'').toLowerCase(); };
  var pool = [];
  var els = document.querySelectorAll(SEL);
  for (var i=0;i<els.length;i++){ var ce = els[i]; if (roleOf(ce)===ROLE && label(ce)===NAME && vis(ce)) pool.push(ce); }
  if (!pool.length) return JSON.stringify({done:false, error:'no visible match (re-observe?)'});
  var el = pool[0];
  for (var k=0;k<pool.length;k++){ if (!pool[k].disabled) { el = pool[k]; break; } }
  var r = el.getBoundingClientRect(), x = r.x + r.width/2, y = r.y + r.height/2;
  if (x<0 || y<0 || x>=window.innerWidth || y>=window.innerHeight) return JSON.stringify({done:false, error:'target outside viewport'});
  var hit = document.elementFromPoint(x, y);
  if (!hit || (hit!==el && !el.contains(hit))) return JSON.stringify({done:false, error:'target occluded (re-observe?)'});
  var tag = (el.tagName||'').toLowerCase();
  if (VERB==='click') { try { el.scrollIntoView({block:'center'}); } catch(e){} await sleep(120); el.click(); }
  else if (VERB==='type') {
    if (tag==='select') return JSON.stringify({done:false, error:'use select verb for dropdowns'});
    el.focus();
    try { var pr = Object.getPrototypeOf(el); var st = Object.getOwnPropertyDescriptor(pr,'value') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value'); if (st && st.set) st.set.call(el,TEXT); else el.value=TEXT; } catch(e){ el.value=TEXT; }
    el.dispatchEvent(new Event('input',{bubbles:true, composed:true}));
    el.dispatchEvent(new Event('change',{bubbles:true, composed:true}));
  }
  else if (VERB==='select') {
    if (tag!=='select') return JSON.stringify({done:false, error:'not a dropdown'});
    var want = TEXT.toLowerCase(), picked = -1;
    for (var o=0;o<el.options.length;o++){ if ((el.options[o].text||'').toLowerCase().indexOf(want)>=0) { picked=o; break; } }
    if (picked<0) return JSON.stringify({done:false, error:'no such option'});
    el.selectedIndex = picked;
    el.dispatchEvent(new Event('input',{bubbles:true, composed:true}));
    el.dispatchEvent(new Event('change',{bubbles:true, composed:true}));
  }
  else return JSON.stringify({done:false, error:'unknown verb '+VERB});
  await sleep(350);
  return JSON.stringify({done:true, verb:VERB, url:location.href});
})()`

type obElement struct {
	Role  string `json:"role"`
	Name  string `json:"name"`
	Value string `json:"value"`
	En    bool   `json:"en"`
	Ops   []string `json:"ops,omitempty"`
}

type observation struct {
	URL      string      `json:"url"`
	Title    string      `json:"title"`
	Text     string      `json:"text"`
	Elements []obElement `json:"elements"`
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

func parseObRef(s string) (int, bool) {
	if !strings.HasPrefix(s, "@e") {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimPrefix(s, "@e"))
	if err != nil || n < 1 {
		return 0, false
	}
	return n, true
}

func decisionsPath(session string) string {
	return filepath.Join(sessionDir(session), "decisions.jsonl")
}

func appendDecision(session string, entry map[string]any) {
	b, _ := json.Marshal(entry)
	_ = os.MkdirAll(sessionDir(session), 0o755)
	f, err := os.OpenFile(decisionsPath(session), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

func readDecisions(session string, n int) []map[string]any {
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

func observeCmd(g *globals, rest []string) int {
	ctx := context.Background()
	port, err := readPort(g.session)
	if err != nil {
		return failErr("no_session", err)
	}
	t, err := pickPageTarget(port)
	if err != nil {
		return failErr("no_page", err)
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	out, err := evalScript(ctx, t.WebSocketDebuggerURL, observeJS, timeout)
	if err != nil {
		return failErr("observe_failed", err)
	}
	var ob observation
	if err := json.Unmarshal([]byte(out), &ob); err != nil {
		return failErr("observe_failed", err)
	}
	items := make([]map[string]any, 0, len(ob.Elements))
	for _, e := range ob.Elements {
		items = append(items, map[string]any{"role": e.Role, "name": e.Name})
	}
	scanCacheSave(g.session, ob.URL, items)
	tools, _, _ := listWebMCP(ctx, t.WebSocketDebuggerURL)
	names := make([]string, 0, len(tools))
	for _, tl := range tools {
		names = append(names, tl.Name)
	}
	if g.json {
		ok(map[string]any{"session": g.session, "url": ob.URL, "title": ob.Title,
			"text": ob.Text, "count": len(ob.Elements), "elements": ob.Elements, "tools": names})
		return 0
	}
	fmt.Printf("%s  (%d controls, %d tools)\n", ob.URL, len(ob.Elements), len(names))
	for i, e := range ob.Elements {
		st := ""
		if !e.En {
			st = " disabled"
		}
		fmt.Printf("  @e%-4d [%s] %s%s\n", i+1, e.Role, e.Name, st)
	}
	return 0
}

func actCmd(g *globals, rest []string) int {
	if len(rest) < 2 || strings.HasPrefix(rest[0], "-") || strings.HasPrefix(rest[1], "-") {
		return fail("usage", "usage: agent-webmcp act <@eN> <click|type|select> [--text ..]")
	}
	ref, verb := rest[0], rest[1]
	switch verb {
	case "click", "type", "select":
	default:
		return fail("usage", "unknown act verb "+strconv.Quote(verb)+" (want click|type|select)")
	}
	n, valid := parseObRef(ref)
	if !valid {
		return fail("usage", "target must be @eN from the last observe")
	}
	role, name, _, _, found := scanCacheLookup(g.session, n)
	if !found {
		return fail("stale_ref", fmt.Sprintf("ref %s not in last observe (run: agent-webmcp observe --session %s)", ref, g.session))
	}
	text, _ := verbFlag(rest, "text")
	if verb != "click" && text == "" {
		return fail("usage", "usage: agent-webmcp act "+ref+" "+verb+" --text \"..\"")
	}
	q := func(s string) string {
		b, _ := json.Marshal(s)
		return string(b)
	}
	expr := actJS2
	expr = strings.ReplaceAll(expr, "@ROLE@", q(role))
	expr = strings.ReplaceAll(expr, "@NAME@", q(name))
	expr = strings.ReplaceAll(expr, "@VERB@", q(verb))
	expr = strings.ReplaceAll(expr, "@TEXT@", q(text))
	ctx := context.Background()
	port, err := readPort(g.session)
	if err != nil {
		return failErr("no_session", err)
	}
	t, err := pickPageTarget(port)
	if err != nil {
		return failErr("no_page", err)
	}
	before := t.URL
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	out, err := evalScript(ctx, t.WebSocketDebuggerURL, expr, timeout)
	if err != nil {
		return failErr("act_failed", err)
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		return failErr("act_failed", err)
	}
	after, _ := m["url"].(string)
	m["session"] = g.session
	m["navigated"] = after != "" && before != "" && after != before
	if g.json {
		ok(m)
		return 0
	}
	if done, _ := m["done"].(bool); done {
		fmt.Printf("%s done (navigated=%v) %s\n", verb, m["navigated"], after)
	} else {
		fmt.Printf("%s failed: %v\n", verb, m["error"])
	}
	return 0
}

func decideCmd(g *globals, rest []string) int {
	goal, _ := verbFlag(rest, "goal")
	if strings.TrimSpace(goal) == "" {
		return fail("usage", "usage: agent-webmcp decide --goal \"..\" [--session NAME]")
	}
	if jevKey() == "" {
		return fail("no_key", "ultrafast needs TYPESAFE_API_KEY in the environment (BYOK — the CLI never bundles a key)")
	}
	ctx := context.Background()
	port, err := readPort(g.session)
	if err != nil {
		return failErr("no_session", err)
	}
	t, err := pickPageTarget(port)
	if err != nil {
		return failErr("no_page", err)
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	out, err := evalScript(ctx, t.WebSocketDebuggerURL, observeJS, timeout)
	if err != nil {
		return failErr("observe_failed", err)
	}
	var ob observation
	if err := json.Unmarshal([]byte(out), &ob); err != nil {
		return failErr("observe_failed", err)
	}
	items := make([]map[string]any, 0, len(ob.Elements))
	for i := range ob.Elements {
		e := &ob.Elements[i]
		e.Ops = opsForRole(e.Role)
		items = append(items, map[string]any{"role": e.Role, "name": e.Name})
	}
	scanCacheSave(g.session, ob.URL, items)
	tools, _, _ := listWebMCP(ctx, t.WebSocketDebuggerURL)
	toolBrief := make([]map[string]any, 0, len(tools))
	for _, tl := range tools {
		toolBrief = append(toolBrief, map[string]any{"name": tl.Name, "description": tl.Description})
	}

	opIDs := map[string]bool{}
	opCriteria := map[string]any{}
	targets := map[string]map[string]bool{}
	targetCriteria := map[string]map[string]any{}
	for i, e := range ob.Elements {
		idx := strconv.Itoa(i + 1)
		for _, op := range e.Ops {
			if !e.En && op != "WAIT" {
				continue
			}
			opIDs[op] = true
			if targets[op] == nil {
				targets[op] = map[string]bool{}
				targetCriteria[op] = map[string]any{}
			}
			targets[op][idx] = true
			targetCriteria[op][idx] = map[string]any{
				"element":       fmt.Sprintf("[%s] %s %s", idx, e.Role, e.Name),
				"current_value": e.Value,
			}
		}
	}
	for _, op := range []string{"WAIT", "DONE", "BLOCKED"} {
		opIDs[op] = true
	}
	for op := range opIDs {
		opCriteria[op] = jevOpLabels[op]
	}
	questions := map[string]any{
		"operation": map[string]any{
			"type":         "choice",
			"instructions": map[string]any{"goal": goal, "rules": jevNextAction},
			"criteria":     opCriteria,
		},
	}
	for op, crit := range targetCriteria {
		qid := strings.ToLower(op) + "_target"
		questions[qid] = map[string]any{
			"type":         "choice",
			"instructions": map[string]any{"goal": goal, "operation": op, "rules": []string{jevNextAction, jevTarget}},
			"criteria":     crit,
		}
	}
	state := map[string]any{
		"goal":           goal,
		"page":           map[string]any{"url": ob.URL, "title": ob.Title, "text": ob.Text},
		"elements":       ob.Elements,
		"tools":          toolBrief,
		"recent_actions": readDecisions(g.session, 10),
	}
	answers, usage, model, lat, err := postSystemOne(state, questions)
	if err != nil {
		return failErr("jev_failed", err)
	}
	var opAns jevChoice
	if raw, present := answers["operation"]; present {
		_ = json.Unmarshal(raw, &opAns)
	}
	op := argmaxChoice(opAns.Probabilities, opIDs)
	if op == "" {
		op = opAns.Choice
	}
	target, anomaly := "", false
	if opIDs[op] && targets[op] != nil {
		var tAns jevChoice
		if raw, present := answers[strings.ToLower(op)+"_target"]; present {
			_ = json.Unmarshal(raw, &tAns)
		}
		target = argmaxChoice(tAns.Probabilities, targets[op])
		if target == "" {
			target = tAns.Choice
		}
		if tAns.Choice != "" && tAns.Choice != target {
			anomaly = true
		}
	}
	if opAns.Choice != "" && opAns.Choice != op {
		anomaly = true
	}
	if err := constrain(opAns, opIDs, op, target, targets[op], targets[op] != nil); err != nil {
		return failErr("jev_unoffered", err)
	}
	ref := ""
	if target != "" {
		ref = "@e" + target
	}
	appendDecision(g.session, map[string]any{
		"operation": op, "target": ref, "confidence": opAns.Confidence, "url": ob.URL,
	})
	res := map[string]any{"session": g.session, "url": ob.URL, "operation": op,
		"target": ref, "confidence": opAns.Confidence, "margin": margin(opAns.Probabilities),
		"latency_ms": lat, "usage": usage, "model": model}
	if anomaly {
		res["anomaly"] = true
	}
	if g.json {
		ok(res)
		return 0
	}
	fmt.Printf("%s %s (conf %.2f, %dms)\n", op, ref, opAns.Confidence, lat)
	return 0
}
