package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

// run: the loop. tick until DONE/BLOCKED, a step budget, or stuck
// (3 consecutive no-change non-wait steps). DONE is a claim, never
// proof: the caller verifies independently.

func runCmd(ctx context.Context, g *globals, rest []string) int {
	goal, _ := verbFlag(rest, "goal")
	if strings.TrimSpace(goal) == "" {
		return fail("usage", "usage: agent-webmcp run --goal \"..\" [--session NAME] [--max-steps N]")
	}
	maxSteps := 30
	if v, ok := verbFlag(rest, "max-steps"); ok {
		if n, err := parseInt(v); err == nil && n > 0 && n <= 60 {
			maxSteps = n
		}
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	reuse := map[string]string{}
	visited := []string{}
	stuck := 0
	steps := 0
	for steps = 0; steps < maxSteps; steps++ {
		receipt, d, code, err := tickOnce(ctx, g.session, goal, timeout, "", "", reuse, visited)
		if err != nil {
			// Agent-supplied values needed: hand back to the calling
			// agent with exactly what's missing. The agent is the
			// text model; it continues stepwise (decide/act).
			if code == "text_needed" || code == "args_needed" {
				return finishRun(g, goal, "BLOCKED", steps, "needs agent: "+err.Error())
			}
			// Login wall: a typed pause, not a failure. The remedy
			// is a one-time human handoff, then the goal re-runs.
			if code == "auth_required" {
				return finishAuthRequired(g, goal, steps, currentPageURL(g.session))
			}
			if g.json {
				fmt.Printf("%s\n", mustJSON(map[string]any{"ok": false, "code": code, "error": err.Error(), "steps": steps}))
			} else {
				fmt.Printf("run stopped: [%s] %s\n", code, err)
			}
			return 1
		}
		if u, _ := receipt["url"].(string); u != "" {
			visited = append(visited, u)
		}
		if g.json {
			fmt.Printf("%s\n", mustJSON(receipt))
		} else {
			fmt.Printf("[%d] %s %s changed=%v (conf %.2f)\n",
				steps+1, receipt["operation"], receipt["target"],
				receipt["page_changed"], d.Confidence)
		}
		if d.Operation == "DONE" || d.Operation == "BLOCKED" {
			if acceptTerminal(d) {
				return finishRun(g, goal, d.Operation, steps+1, "terminal choice")
			}
			// A shrug is not a result: the stop was already given
			// its forced-exploration second look inside the tick,
			// so record it as an unconfirmed BLOCKED, never success.
			return finishRun(g, goal, "BLOCKED", steps+1,
				fmt.Sprintf("unconfirmed stop: %s at conf %.2f < %.2f (goal_complete %.2f)",
					d.Operation, d.Confidence, terminalConfidenceFloor, d.GoalComplete))
		}
		if changed, _ := receipt["page_changed"].(bool); !changed && d.Operation != "WAIT" && d.Operation != "INVOKE" {
			stuck++
			if stuck >= 3 {
				return finishRun(g, goal, "BLOCKED", steps+1, "stuck: 3 no-change steps")
			}
		} else {
			stuck = 0
		}
	}
	return finishRun(g, goal, "BLOCKED", steps, "step budget exhausted")
}

// Exit codes are the contract: 0 = DONE, 1 = blocked/failed, 2 =
// auth_required (a typed pause with a human remedy, not a failure).
func finishRun(g *globals, goal, status string, steps int, reason string) int {
	data := map[string]any{"status": status, "steps": steps, "reason": reason, "goal": goal}
	if status == "DONE" {
		if g.json {
			ok(data)
			return 0
		}
		fmt.Printf("run %s after %d steps (%s) — verify independently\n", status, steps, reason)
		return 0
	}
	if g.json {
		fmt.Printf("%s\n", mustJSON(map[string]any{"ok": false, "code": "blocked", "error": reason, "data": data}))
		return 1
	}
	fmt.Fprintf(os.Stderr, "run %s after %d steps (%s) — verify independently\n", status, steps, reason)
	return 1
}
