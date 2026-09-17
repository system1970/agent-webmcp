package main

import "testing"

func TestConstrainOffered(t *testing.T) {
	op := jevChoice{Choice: "CLICK", Probabilities: map[string]float64{"CLICK": 0.8, "WAIT": 0.2}}
	ids := map[string]bool{"CLICK": true, "WAIT": true, "DONE": true, "BLOCKED": true}
	tids := map[string]bool{"3": true}
	if err := constrain(op, ids, "CLICK", "3", tids, true); err != nil {
		t.Fatalf("offered pair should pass: %v", err)
	}
	if err := constrain(op, ids, "DONE", "", nil, false); err != nil {
		t.Fatalf("DONE needs no target: %v", err)
	}
}

func TestConstrainRefuses(t *testing.T) {
	op := jevChoice{Choice: "CLICK", Probabilities: map[string]float64{"CLICK": 0.9}}
	ids := map[string]bool{"CLICK": true}
	if err := constrain(op, ids, "TYPE_TEXT", "", nil, false); err == nil {
		t.Fatal("unoffered operation should refuse")
	}
	if err := constrain(op, ids, "CLICK", "99", map[string]bool{"3": true}, true); err == nil {
		t.Fatal("unoffered target should refuse")
	}
}

func TestMargin(t *testing.T) {
	if m := margin(map[string]float64{"a": 0.7, "b": 0.2, "c": 0.1}); m < 0.49 || m > 0.51 {
		t.Fatalf("margin = %v, want 0.5", m)
	}
	if m := margin(map[string]float64{"a": 1}); m != 1 {
		t.Fatalf("single option margin = %v, want 1", m)
	}
	if m := margin(nil); m != 1 {
		t.Fatalf("empty margin = %v, want 1", m)
	}
}

func TestArgmaxIgnoresUnoffered(t *testing.T) {
	probs := map[string]float64{"ZZZ": 0.9, "CLICK": 0.1}
	if got := argmaxChoice(probs, map[string]bool{"CLICK": true}); got != "CLICK" {
		t.Fatalf("argmax = %q, want CLICK", got)
	}
	if got := argmaxChoice(probs, map[string]bool{"NOPE": true}); got != "" {
		t.Fatalf("argmax with no overlap = %q, want empty", got)
	}
}

func TestOpsForRole(t *testing.T) {
	if got := opsForRole("textbox"); len(got) != 1 || got[0] != "TYPE_TEXT" {
		t.Fatalf("textbox ops = %v", got)
	}
	if got := opsForRole("button"); len(got) != 1 || got[0] != "CLICK" {
		t.Fatalf("button ops = %v", got)
	}
	if got := opsForRole("select"); len(got) != 1 || got[0] != "SELECT" {
		t.Fatalf("select ops = %v", got)
	}
	if got := opsForRole("hidden"); got != nil {
		t.Fatalf("hidden ops = %v, want nil", got)
	}
}

func TestVerbFlag(t *testing.T) {
	v, ok := verbFlag([]string{"act", "@e3", "--text", "hi"}, "text")
	if !ok || v != "hi" {
		t.Fatalf("verbFlag = %q,%v", v, ok)
	}
	v, ok = verbFlag([]string{"--goal=x y"}, "goal")
	if !ok || v != "x y" {
		t.Fatalf("verbFlag eq form = %q,%v", v, ok)
	}
	if _, ok := verbFlag([]string{"--other", "z"}, "goal"); ok {
		t.Fatal("missing flag should miss")
	}
}
