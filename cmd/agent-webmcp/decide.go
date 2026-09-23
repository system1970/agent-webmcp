package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// decide: one Jev call over a fresh snapshot + tool list. Prints the
// operation + target, saves both for act. Never acts.

type decision struct {
	Operation     string             `json:"operation"`
	Target        string             `json:"target"`
	Choice        string             `json:"choice"`
	Confidence    float64            `json:"confidence"`
	Margin        float64            `json:"margin"`
	GoalComplete  float64            `json:"goal_complete"`
	Anomaly       bool               `json:"anomaly"`
	Probabilities map[string]float64 `json:"probabilities"`
	LatencyMs     int64              `json:"latency_ms"`
	Model         string             `json:"model"`
	Usage         map[string]any     `json:"usage"`
}

func decisionsPath(session string) string {
	return filepath.Join(sessionDir(session), "decisions.jsonl")
}

func snapshotPath(session string) string {
	return filepath.Join(sessionDir(session), "last-snapshot.json")
}

func saveDecision(session string, d *decision, snap *snapshot, tools []WebMCPTool, goal, run string) {
	_ = os.MkdirAll(sessionDir(session), 0o755)
	rec := map[string]any{"kind": "decision", "goal": goal, "decision": d}
	if run != "" {
		rec["run"] = run
	}
	b, _ := json.Marshal(rec)
	f, err := os.OpenFile(decisionsPath(session), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err == nil {
		_, _ = f.Write(append(b, '\n'))
		f.Close()
	}
	sb, _ := json.Marshal(map[string]any{"goal": goal, "decision": d, "snapshot": snap, "tools": tools})
	_ = os.WriteFile(snapshotPath(session), sb, 0o644)
}

func opsForKind(kind string) string {
	switch kind {
	case "click":
		return "CLICK"
	case "fill":
		return "TYPE_TEXT"
	case "select":
		return "SELECT"
	case "scroll":
		return "SCROLL"
	}
	return ""
}

// lastVisited keeps the tail of the visited-URL list for state.
func lastVisited(v []string, n int) []string {
	if len(v) <= n {
		return v
	}
	return v[len(v)-n:]
}

func decideCmd(ctx context.Context, g *globals, rest []string) int {
	goal, _ := verbFlag(rest, "goal")
	if strings.TrimSpace(goal) == "" {
		return fail("usage", "usage: agent-webmcp decide --goal \"..\" [--session NAME]")
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	d, snap, tools, code, err := decideOnce(ctx, g.session, goal, timeout, nil, false, "")
	if err != nil {
		return failErr(code, err)
	}
	d, snap, tools = retryUncertainStop(ctx, g.session, goal, timeout, nil, d, snap, tools, "")
	saveDecision(g.session, d, snap, tools, goal, "")
	if g.json {
		ok(map[string]any{
			"operation": d.Operation, "target": d.Target, "choice": d.Choice,
			"confidence": d.Confidence, "margin": d.Margin, "anomaly": d.Anomaly,
			"goal_complete": d.GoalComplete,
			"latency_ms":    d.LatencyMs, "model": d.Model, "usage": d.Usage,
		})
		return 0
	}
	fmt.Printf("%s %s (conf %.2f, margin %.2f, %dms)\n", d.Operation, d.Target, d.Confidence, d.Margin, d.LatencyMs)
	return 0
}

// buildState assembles Jev state with variable redaction. Live field
// values and agent-supplied text stay in the snapshot and guards for
// act, but never enter model state: the judge sees labels, roles, and
// history shapes — never secrets. (Stagehand redacts %variable% the
// same way, in requests and traces.)
func buildState(goal string, snap *snapshot, tools []WebMCPTool, history []map[string]any, visited []string) map[string]any {
	els := make([]map[string]any, 0, len(snap.Actions))
	for _, a := range snap.Actions {
		if a.Kind == "wait" {
			continue
		}
		// filled is presence-without-content: the judge must know a
		// field already holds text (else it refills forever — observed
		// live: 3× TYPE_TEXT, 0 changes), but the value itself is a
		// secret and stays out (Stagehand placeholder discipline).
		filled := a.Kind == "fill" && a.Value != ""
		els = append(els, map[string]any{"index": a.ID, "kind": a.Kind, "role": a.Role, "label": a.Label, "filled": filled})
	}
	toolBrief := make([]map[string]any, 0, len(tools))
	for _, tl := range tools {
		toolBrief = append(toolBrief, map[string]any{"name": tl.Name, "description": tl.Description})
	}
	recent := []map[string]any{}
	for _, m := range history {
		op, _ := m["operation"].(string)
		if op == "" {
			continue
		}
		recent = append(recent, map[string]any{
			"action": m["target"], "kind": op,
			"page_changed": m["page_changed"], "confidence": m["confidence"],
		})
	}
	return map[string]any{
		"goal":           goal,
		"page":           map[string]any{"url": snap.URL, "title": snap.Title, "text": snap.Text},
		"elements":       els,
		"tools":          toolBrief,
		"recent_actions": recent,
		"visited":        lastVisited(visited, 12),
	}
}

// decideOnce: snapshot + fan-out POST + validate. Shared by decide and tick.
// visited carries recent page URLs so the policy avoids going in circles.
// forceExplore drops BLOCKED from the offered ops for one retry when a
// low-confidence stop looks like uncertainty rather than impossibility.
func decideOnce(ctx context.Context, session, goal string, timeout time.Duration, visited []string, forceExplore bool, run string) (*decision, *snapshot, []WebMCPTool, string, error) {
	fail := func(code string, err error) (*decision, *snapshot, []WebMCPTool, string, error) {
		return nil, nil, nil, code, err
	}
	if jevKey() == "" {
		return fail("no_key", fmt.Errorf("ultrafast needs TYPESAFE_API_KEY (BYOK — the CLI never bundles a key)"))
	}
	snap, _, err := captureSnapshot(ctx, session, timeout)
	if err != nil {
		return fail("observe_failed", err)
	}
	if detectBotWall(snap.URL, snap.Text) {
		return fail("bot_wall", fmt.Errorf("bot check page (%s) — stopping before burning steps", snap.URL))
	}
	if detectLoginWall(snap.URL, snap.Text) {
		return fail("auth_required", fmt.Errorf("login wall at %s — one-time handoff: auth handoff --session %s --url %s", snap.URL, session, snap.URL))
	}
	t, err := sessionTarget(session, timeout)
	if err != nil {
		return fail("no_page", err)
	}
	tools, _, _ := listWebMCP(ctx, t.WebSocketDebuggerURL, timeout)
	tools = ensureCustomTools(ctx, session, t.WebSocketDebuggerURL, snap.URL, timeout, tools)
	opIDs := map[string]bool{}
	opCriteria := map[string]any{}
	targets := map[string]map[string]bool{}
	targetCriteria := map[string]map[string]any{}
	byID := map[string]snapAction{}
	for _, a := range snap.Actions {
		byID[a.ID] = a
		op := ""
		// Scroll is an offered op (the page is longer than the
		// viewport); the synthetic wait action stays unoffered —
		// the WAIT op covers it.
		if a.Kind == "wait" {
			continue
		}
		op = opsForKind(a.Kind)
		if op == "" {
			continue
		}
		opIDs[op] = true
		if targets[op] == nil {
			targets[op] = map[string]bool{}
			targetCriteria[op] = map[string]any{}
		}
		targets[op][a.ID] = true
		targetCriteria[op][a.ID] = fmt.Sprintf("[%s] %s %s", a.ID, a.Role, a.Label)
	}
	// decide's INVOKE head covers page-registered tools only (native +
	// injected custom). Loop-backed tools live in the CLI registry and
	// are invoked by name; loop-in-loop reentrancy is deferred, so they
	// are deliberately not offered here.
	if len(tools) > 0 {
		opIDs["INVOKE"] = true
		targets["INVOKE"] = map[string]bool{}
		targetCriteria["INVOKE"] = map[string]any{}
		for _, tl := range tools {
			targets["INVOKE"][tl.Name] = true
			targetCriteria["INVOKE"][tl.Name] = tl.Name + ": " + firstLine(tl.Description)
		}
	}
	for _, op := range []string{"WAIT", "DONE"} {
		opIDs[op] = true
	}
	// Every target head offers an explicit no-match: a forced pick among
	// ill-fitting targets is a guess, and guesses are never stored.
	for op := range targets {
		targets[op]["none"] = true
		targetCriteria[op]["none"] = "None of the offered targets fits the goal — choose this instead of guessing."
	}
	if !forceExplore {
		opIDs["BLOCKED"] = true
	}
	for op := range opIDs {
		opCriteria[op] = jevOpLabels[op]
	}
	opRules := any(jevNextAction)
	tgtRules := []string{jevNextAction, jevTarget}
	if forceExplore {
		opRules = []string{jevNextAction, jevExplore}
		tgtRules = []string{jevNextAction, jevTarget, jevExplore}
	}
	questions := map[string]any{
		"operation": map[string]any{
			"type":         "choice",
			"instructions": map[string]any{"goal": goal, "rules": opRules},
			"criteria":     opCriteria,
		},
		"goal_complete": map[string]any{
			"type":         "noul",
			"instructions": map[string]any{"goal": goal, "rules": jevGoalComplete},
		},
	}
	for op, crit := range targetCriteria {
		qid := strings.ToLower(op) + "_target"
		questions[qid] = map[string]any{
			"type":         "choice",
			"instructions": map[string]any{"goal": goal, "operation": op, "rules": tgtRules},
			"criteria":     crit,
		}
	}
	state := buildState(goal, snap, tools, readHistory(session, 10, run), visited)
	answers, usage, model, lat, err := postSystemOne(state, questions)
	if err != nil {
		return fail("jev_failed", err)
	}
	var opAns jevChoice
	if raw, ok := answers["operation"]; ok {
		_ = json.Unmarshal(raw, &opAns)
	}
	op := argmaxChoice(opAns.Probabilities, opIDs)
	if op == "" {
		op = opAns.Choice
	}
	anomaly := opAns.Choice != "" && opAns.Choice != op
	target, choice := "", op
	if tg, ok := targets[op]; ok && tg != nil {
		var tAns jevChoice
		if raw, ok := answers[strings.ToLower(op)+"_target"]; ok {
			_ = json.Unmarshal(raw, &tAns)
		}
		target = argmaxChoice(tAns.Probabilities, tg)
		if target == "" {
			target = tAns.Choice
		}
		if tAns.Choice != "" && tAns.Choice != target {
			anomaly = true
		}
		if op == "INVOKE" {
			choice = "invoke:" + target
		} else {
			choice = target
		}
	}
	completeP := -1.0
	if raw, ok := answers["goal_complete"]; ok {
		var n struct {
			Noul float64 `json:"noul"`
		}
		if json.Unmarshal(raw, &n) == nil {
			completeP = n.Noul
		}
	}
	if completeP >= goalCompleteThreshold {
		op, target, choice = "DONE", "", "DONE"
	} else if target == "none" {
		// Explicit no-match is not a target: one forced-exploration
		// second look, then an honest low-confidence BLOCKED. The run
		// refuses it as success; act never sees "none".
		if !forceExplore {
			if d2, snap2, tools2, _, err2 := decideOnce(ctx, session, goal, timeout, visited, true, run); err2 == nil && d2.Operation != "BLOCKED" {
				return d2, snap2, tools2, "", nil
			}
		}
		return &decision{
			Operation: "BLOCKED", Target: "", Choice: "no offered target fits",
			Confidence: 0.5, Margin: margin(opAns.Probabilities),
			GoalComplete: completeP, Anomaly: anomaly, Probabilities: opAns.Probabilities,
			LatencyMs: lat, Model: model, Usage: usage,
		}, snap, tools, "", nil
	}
	if err := constrain(opIDs, op, target, targets[op], targets[op] != nil); err != nil {
		return fail("jev_unoffered", err)
	}
	d := &decision{
		Operation: op, Target: target, Choice: choice,
		Confidence: opAns.Confidence, Margin: margin(opAns.Probabilities),
		GoalComplete: completeP,
		Anomaly:      anomaly, Probabilities: opAns.Probabilities,
		LatencyMs: lat, Model: model, Usage: usage,
	}
	return d, snap, tools, "", nil
}
