package main

import (
	"context"
	"time"
)

// Shared acceptance policy. Thresholds are code-owned and fit to loop
// data — do not retune from theory, re-run the read-only battery.
// DONE is accepted on its own head (goal_complete); BLOCKED on the
// operation-choice head. A terminal claim under threshold is a shrug:
// the run refuses to record it as success.

// terminalConfidenceFloor gates terminal claims. Below it, DONE/BLOCKED
// do not terminate as success.
const terminalConfidenceFloor = 0.7

// uncertainStopFloor gates the forced-exploration retry: a stop under
// it is uncertainty, not impossibility, and gets one re-decide with
// BLOCKED unoffered.
const uncertainStopFloor = 0.6

// acceptTerminal reports whether a terminal decision carries enough
// confidence to end a run as stated.
func acceptTerminal(d *decision) bool {
	if d == nil {
		return false
	}
	switch d.Operation {
	case "DONE":
		return d.GoalComplete >= terminalConfidenceFloor
	case "BLOCKED":
		return d.Confidence >= terminalConfidenceFloor
	}
	return false
}

// retryUncertainStop re-decides once with BLOCKED unoffered when a stop
// looks like uncertainty rather than impossibility. Shared by the split
// decide verb and the fused tick so the two paths cannot drift apart.
func retryUncertainStop(ctx context.Context, session, goal string, timeout time.Duration, visited []string, d *decision, snap *snapshot, tools []WebMCPTool) (*decision, *snapshot, []WebMCPTool) {
	if (d.Operation == "BLOCKED" || d.Operation == "WAIT") && d.Confidence < uncertainStopFloor {
		if d2, snap2, tools2, _, err := decideOnce(ctx, session, goal, timeout, visited, true); err == nil {
			if d2.Operation != "BLOCKED" || d2.Confidence > d.Confidence {
				return d2, snap2, tools2
			}
		}
	}
	return d, snap, tools
}
