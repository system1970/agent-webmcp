package main

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// tick: the fused ultrafast step. Observe + decide + act in one process:
// one snapshot, one Jev call, one execution. Stale decisions re-decide
// once in-process (agent text reused when the field is unchanged).
// Low-margin actionable decisions get one fresh-eyes re-decide; the
// higher-confidence decision wins. Text/params come from the calling
// agent via flags: the agent holding the goal is the text model.

const marginRetryFloor = 0.25

func tickCmd(ctx context.Context, g *globals, rest []string) int {
	goal, _ := verbFlag(rest, "goal")
	if strings.TrimSpace(goal) == "" {
		return fail("usage", "usage: agent-webmcp tick --goal \"..\" [--session NAME] [--text ..] [--params ..]")
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	started := time.Now()
	reuse := map[string]string{}
	receipt, d, code, err := tickOnce(ctx, g.session, goal, timeout, g.text, g.params, reuse)
	if err != nil {
		return failErr(code, err)
	}
	receipt["latency_ms"] = time.Since(started).Milliseconds()
	if g.json {
		ok(receipt)
		return 0
	}
	fmt.Printf("%s %s executed=%v changed=%v (conf %.2f, %dms)\n",
		receipt["operation"], receipt["target"], receipt["executed"],
		receipt["page_changed"], d.Confidence, receipt["latency_ms"])
	return 0
}

func tickOnce(ctx context.Context, session, goal string, timeout time.Duration, text, params string, reuse map[string]string) (map[string]any, *decision, string, error) {
	fail := func(code string, err error) (map[string]any, *decision, string, error) {
		return nil, nil, code, err
	}
	var d *decision
	var snap *snapshot
	var tools []WebMCPTool
	for attempt := 0; attempt < 2; attempt++ {
		var code string
		var err error
		d, snap, tools, code, err = decideOnce(ctx, session, goal, timeout)
		if err != nil {
			return fail(code, err)
		}
		// Fresh eyes once on low-margin actionable calls.
		if d.Margin < marginRetryFloor && attempt == 0 &&
			d.Operation != "DONE" && d.Operation != "BLOCKED" && d.Operation != "WAIT" {
			d2, snap2, tools2, code2, err2 := decideOnce(ctx, session, goal, timeout)
			if err2 == nil && d2.Confidence > d.Confidence {
				d, snap, tools = d2, snap2, tools2
			} else if err2 != nil {
				_ = code2
			}
		}
		saveDecision(session, d, snap, tools, goal)
		receipt, code, err := actExecute(ctx, session, goal, d, snap, tools, timeout, text, params, reuse)
		if err == nil {
			after, _, capErr := captureSnapshot(ctx, session, timeout)
			changed := false
			if capErr == nil {
				changed = fingerprintSnap(snap) !=
					fingerprintSnap(after)
				receipt["url"] = after.URL
			}
			receipt["page_changed"] = changed
			receipt["confidence"] = d.Confidence
			receipt["margin"] = d.Margin
			appendExecuted(session, map[string]any{
				"operation": d.Operation, "target": d.Target,
				"page_changed": changed, "confidence": d.Confidence,
			})
			return receipt, d, "", nil
		}
		if code != "stale" || attempt == 1 {
			return fail(code, err)
		}
		// Stale: loop re-decides against the fresh page.
	}
	return fail("stale", fmt.Errorf("page changed twice (re-tick)"))
}
