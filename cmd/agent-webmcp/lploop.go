package main

// The Lightpanda loop. run works on an engine that forgets everything when
// its CDP connection closes.
//
// Lightpanda drops all page state on disconnect (verified: fill a field, close
// the connection, reopen one -> about:blank with nothing filled). agent-webmcp's
// split verbs are cross-invocation by design — decide observes in one process,
// act acts in the next — so on Lightpanda only the fused run loop works: one
// connection held open for every step. main.go refuses decide, act and tick
// here with that reason.
//
// Everything above the browser boundary is shared with Chrome. decideOnce still
// builds the redacted state and calls Jev, runLoop still counts no-change steps,
// stuck detection still trips, the exit contract is the same. Only the snapshot
// source and the three execution calls swap, and both go through checkFresh so
// the freshness rule is written once.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// lpLoop is a live Lightpanda page. It owns the process and the one CDP
// connection, and it must be closed by whoever started it.
type lpLoop struct {
	proc    *lpProcess
	conn    *CDP
	sid     string
	session string
	timeout time.Duration
}

type lpLoopCtxKey struct{}

// withLPLoop attaches the live page to ctx. captureSnapshot and actExecute read
// it from there, so nothing above the browser boundary needs a new parameter.
func withLPLoop(ctx context.Context, l *lpLoop) context.Context {
	return context.WithValue(ctx, lpLoopCtxKey{}, l)
}

func lpLoopFrom(ctx context.Context) *lpLoop {
	l, _ := ctx.Value(lpLoopCtxKey{}).(*lpLoop)
	return l
}

func (l *lpLoop) close() {
	if l.conn != nil {
		l.conn.Close()
		l.conn = nil
	}
	if l.proc != nil {
		l.proc.kill()
		l.proc = nil
	}
}

// call issues one CDP command on the held session. Every page command needs the
// session id, which is why this goes through lpCall and not CDP.Call.
func (l *lpLoop) call(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	return lpCall(ctx, l.conn, l.proc, method, params, l.sid, l.timeout)
}

// startLPLoop launches an engine, opens one page, and navigates it. The
// connection stays open until close.
func startLPLoop(ctx context.Context, binPath, session, target string, timeout time.Duration) (*lpLoop, error) {
	bin, err := findLightpanda(binPath)
	if err != nil {
		return nil, err
	}
	proc, err := launchLightpanda(ctx, bin)
	if err != nil {
		return nil, err
	}
	l := &lpLoop{proc: proc, session: session, timeout: timeout}

	dctx, cancel := context.WithTimeout(ctx, timeout)
	conn, err := dialCDP(dctx, proc.wsURL)
	cancel()
	if err != nil {
		l.close()
		return nil, err
	}
	l.conn = conn

	// The target is created blank so the session exists before any page code
	// runs; Lightpanda reports an empty document for an unattached page.
	tgt, err := conn.Call(ctx, "Target.createTarget", map[string]any{"url": "about:blank"})
	if err != nil {
		l.close()
		return nil, fmt.Errorf("lightpanda: createTarget: %v", err)
	}
	var created struct {
		TargetID string `json:"targetId"`
	}
	if json.Unmarshal(tgt, &created) != nil || created.TargetID == "" {
		l.close()
		return nil, fmt.Errorf("lightpanda: no target id from createTarget")
	}
	att, err := conn.Call(ctx, "Target.attachToTarget", map[string]any{"targetId": created.TargetID, "flatten": true})
	if err != nil {
		l.close()
		return nil, fmt.Errorf("lightpanda: attachToTarget: %v", err)
	}
	var attached struct {
		SessionID string `json:"sessionId"`
	}
	if json.Unmarshal(att, &attached) != nil || attached.SessionID == "" {
		l.close()
		return nil, fmt.Errorf("lightpanda: no session id from attachToTarget")
	}
	l.sid = attached.SessionID

	if target != "" && !strings.HasPrefix(target, "about:") {
		if err := checkURLPolicy(allowedDomainsFromEnv(), target); err != nil {
			l.close()
			return nil, err
		}
		if _, err := l.call(ctx, "Page.navigate", map[string]any{"url": target}); err != nil {
			l.close()
			return nil, fmt.Errorf("lightpanda: navigate %s: %v", target, err)
		}
		if err := l.waitReady(ctx); err != nil {
			l.close()
			return nil, err
		}
	}
	return l, nil
}

func (l *lpLoop) waitReady(ctx context.Context) error {
	deadline := time.Now().Add(l.timeout)
	for time.Now().Before(deadline) {
		res, err := l.call(ctx, "Runtime.evaluate", map[string]any{
			"expression": "document.readyState", "returnByValue": true,
		})
		if err == nil && lpValueString(res) == "complete" {
			return nil
		}
		time.Sleep(150 * time.Millisecond)
	}
	// A soft deadline on purpose: a single-page app never reports complete, and
	// the snapshot is what the loop actually reads. A hard failure here would
	// refuse to act on pages that are ready enough to use.
	return nil
}

// observe builds a snapshot on the held page. Same struct, same fields as the
// Chrome path, so buildState — and therefore PII redaction — is unchanged.
func (l *lpLoop) observe(ctx context.Context) (*snapshot, error) {
	els, err := l.call(ctx, "LP.getInteractiveElements", map[string]any{})
	if err != nil {
		return nil, fmt.Errorf("lightpanda: LP.getInteractiveElements: %v", err)
	}
	var ir lpInteractiveResult
	if err := json.Unmarshal(els, &ir); err != nil {
		return nil, fmt.Errorf("lightpanda: cannot parse getInteractiveElements: %v", err)
	}

	var snapURL, snapTitle, text string
	if v, err := l.call(ctx, "Runtime.evaluate", map[string]any{"expression": "location.href", "returnByValue": true}); err == nil {
		snapURL = lpValueString(v)
	}
	if v, err := l.call(ctx, "Runtime.evaluate", map[string]any{"expression": "document.title", "returnByValue": true}); err == nil {
		snapTitle = lpValueString(v)
	}
	// Markdown is a nice-to-have; the element list is the snapshot.
	if md, err := l.call(ctx, "LP.getMarkdown", map[string]any{}); err == nil {
		var mr lpMarkdownResult
		if json.Unmarshal(md, &mr) == nil {
			text = mr.Markdown
		}
	}
	return lpBuildSnapshot(snapURL, snapTitle, text, ir, l.nodeDetails(ctx, ir.Elements)), nil
}

// nodeDetails reads one LP.getNodeDetails per element. This is the extra round
// trip that buys parity with observeJS: the real input type, the live value,
// the toggle state, and the options behind a dropdown. getInteractiveElements
// alone cannot tell a text field from a password field.
//
// A failed read is not fatal. The element is still offered from its role and
// tag, because a read that failed must not hide a control the judge could use.
func (l *lpLoop) nodeDetails(ctx context.Context, els []lpInteractive) []lpNodeDetails {
	out := make([]lpNodeDetails, 0, len(els))
	for _, e := range els {
		var d lpNodeDetails
		if res, err := l.call(ctx, "LP.getNodeDetails", map[string]any{"backendNodeId": e.BackendNodeID}); err == nil {
			var wrapped struct {
				NodeDetails lpNodeDetails `json:"nodeDetails"`
			}
			if json.Unmarshal(res, &wrapped) == nil {
				d = wrapped.NodeDetails
			}
		}
		out = append(out, d)
	}
	return out
}

// lpSelector resolves a node to a CSS selector through LP.getNodeDetails. The
// selector is how a node is found again after the page changed:
// backendNodeId does not survive a navigation, the selector does.
func (l *lpLoop) lpSelector(ctx context.Context, node int) (string, error) {
	res, err := l.call(ctx, "LP.getNodeDetails", map[string]any{"backendNodeId": node})
	if err != nil {
		return "", fmt.Errorf("lightpanda: getNodeDetails(%d): %v", node, err)
	}
	var out struct {
		NodeDetails struct {
			Selector string `json:"selector"`
		} `json:"nodeDetails"`
	}
	if err := json.Unmarshal(res, &out); err != nil || out.NodeDetails.Selector == "" {
		return "", fmt.Errorf("lightpanda: no selector for node %d", node)
	}
	return out.NodeDetails.Selector, nil
}

// actLP runs one decision against the held Lightpanda page. It mirrors
// actExecute: same operations, same text rules, same freshness gate, same
// receipts. Only the three execution calls differ, and Chrome's geometry
// hit-test has no counterpart here because Lightpanda resolves a node directly.
func actLP(ctx context.Context, l *lpLoop, goal string, d *decision, saved *snapshot, text, params string, reuse map[string]string, run string) (map[string]any, string, error) {
	fail := func(code string, err error) (map[string]any, string, error) { return nil, code, err }
	_ = goal // the goal reaches the judge, not the executor
	d.Target = normalizeTarget(d.Target)

	switch d.Operation {
	case "DONE", "BLOCKED":
		// A terminal claim needs a fresh page: a DONE decided on stale state is
		// not evidence.
		fresh, err := l.observe(ctx)
		if err != nil {
			return fail("observe_failed", err)
		}
		if fingerprintSnap(saved) != fingerprintSnap(fresh) {
			return fail("stale", fmt.Errorf("page changed since decision (re-decide)"))
		}
		return map[string]any{"operation": d.Operation, "target": "", "executed": false}, "", nil
	case "WAIT":
		time.Sleep(100 * time.Millisecond)
		appendExecuted(l.session, run, map[string]any{"operation": "WAIT", "target": ""})
		return map[string]any{"operation": "WAIT", "target": "", "executed": true}, "", nil
	case "INVOKE":
		// Refuse rather than pretend. The LP domain does expose WebMCP.invokeTool,
		// but this CLI has not verified it against a live site.
		return fail("engine_unsupported", requireChrome(EngineLightpanda, FeatureWebMCP))
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

	// Text is agent-supplied via --text; pending text survives a stale retry
	// inside one tick.
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
	if action.Kind == "select" && strings.TrimSpace(action.Value) == "" {
		// A dropdown is offered one action per option, so the option value
		// normally travels in the snapshot and no flag is needed. --params is
		// the fallback for a select that came with no options.
		if strings.TrimSpace(params) == "" {
			return fail("params_needed", fmt.Errorf("select %q needs a value (agent supplies --params)", action.Label))
		}
		action.Value = params
	}

	fresh, err := l.observe(ctx)
	if err != nil {
		return fail("observe_failed", err)
	}
	// Every kind is guarded here, select included. Chrome has to exempt select
	// because its guard holds the value and selectedIndex, which the act itself
	// changes; the Lightpanda guard holds tag, role and href only, so setting a
	// dropdown cannot move it.
	if err := checkFresh(saved, fresh, action.Node); err != nil {
		return fail("stale", err)
	}

	// The selector is how the node is named in the receipt, and it is the only
	// handle that survives a navigation. A miss here is not fatal: clickNode and
	// fillNode take the node id directly.
	selector, selErr := l.lpSelector(ctx, action.Node)

	switch action.Kind {
	case "click":
		if _, err := l.call(ctx, "LP.clickNode", map[string]any{"backendNodeId": action.Node}); err != nil {
			return fail("act_failed", fmt.Errorf("lightpanda: clickNode: %v", err))
		}
	case "fill":
		if _, err := l.call(ctx, "LP.fillNode", map[string]any{"backendNodeId": action.Node, "text": text}); err != nil {
			return fail("act_failed", fmt.Errorf("lightpanda: fillNode: %v", err))
		}
		if selErr == nil {
			if err := l.verifyFill(ctx, selector, action.Node, text); err != nil {
				return fail("act_failed", err)
			}
		}
	case "select":
		// There is no LP command for a dropdown. Set it through the resolved
		// selector and read the value back, so a silent no-op is an error
		// instead of a lost step.
		if selErr != nil {
			return fail("stale", selErr)
		}
		if err := l.setSelect(ctx, selector, action.Value); err != nil {
			return fail("act_failed", err)
		}
	}

	entry := map[string]any{"operation": d.Operation, "target": d.Target, "confidence": d.Confidence}
	if text != "" {
		entry["text"] = text
	}
	appendExecuted(l.session, run, entry)

	receipt := map[string]any{
		"operation": d.Operation, "target": d.Target, "executed": true,
		"engine": string(EngineLightpanda),
	}
	if selErr == nil {
		receipt["selector"] = selector
	}
	if text != "" {
		receipt["text"] = text
	}
	return receipt, "", nil
}

// verifyFill reads a filled field back through its selector. fillNode reports
// success for a node it could not write, so the value is checked the same way
// the Chrome path checks it after Input.insertText. A field that rejected the
// write must fail the step, not pass it silently.
func (l *lpLoop) verifyFill(ctx context.Context, selector string, node int, want string) error {
	res, err := l.call(ctx, "Runtime.evaluate", map[string]any{
		"expression":     fmt.Sprintf("(()=>{const e=document.querySelector(%s);return e&&'value' in e?String(e.value):''})()", lpQuote(selector)),
		"returnByValue": true,
	})
	if err != nil {
		return nil // the read is a check, not the operation
	}
	got := lpValueString(res)
	if got == want {
		return nil
	}
	if got == "" {
		return fmt.Errorf("lightpanda: fillNode wrote nothing to node %d", node)
	}
	return fmt.Errorf("lightpanda: node %d holds %q, wanted %q", node, got, want)
}

// setSelect chooses a dropdown option through the resolved selector and fires
// the events a page listens for.
func (l *lpLoop) setSelect(ctx context.Context, selector, value string) error {
	expr := fmt.Sprintf(`(()=>{const e=document.querySelector(%s);
  if(!e) return 'gone';
  const v=%s, o=[...e.options].find(x=>x.value===v||x.label===v);
  if(!o) return 'no_option';
  e.value=o.value;
  e.dispatchEvent(new Event('input',{bubbles:true}));
  e.dispatchEvent(new Event('change',{bubbles:true}));
  return e.value===o.value?'ok':'not_applied';})()`, lpQuote(selector), lpQuote(value))
	res, err := l.call(ctx, "Runtime.evaluate", map[string]any{"expression": expr, "returnByValue": true})
	if err != nil {
		return fmt.Errorf("lightpanda: select %s: %v", selector, err)
	}
	switch got := lpValueString(res); got {
	case "ok":
		return nil
	case "gone":
		return fmt.Errorf("lightpanda: select %s: element is gone (re-decide)", selector)
	case "no_option":
		return fmt.Errorf("lightpanda: select %s: no option %q (agent supplies --params)", selector, value)
	default:
		return fmt.Errorf("lightpanda: select %s: %s", selector, got)
	}
}

// lastSeenURL is where the session last was, read from the saved snapshot.
// The run loop on Lightpanda needs it as the page to open: there is no browser
// to ask, because this process is about to launch the only one there will be.
// A session that has never been observed yields "", which starts at about:blank
// and is a correct, if useless, loop.
func lastSeenURL(session string) string {
	b, err := os.ReadFile(snapshotPath(session))
	if err != nil {
		return ""
	}
	var saved struct {
		Snapshot *snapshot `json:"snapshot"`
	}
	if json.Unmarshal(b, &saved) != nil || saved.Snapshot == nil {
		return ""
	}
	return saved.Snapshot.URL
}

// lpQuote renders a Go string as a JavaScript string literal.
func lpQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}