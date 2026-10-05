# Where does Jev live inside crafted tools?

Type: grilling
Status: resolved

## Answer

Ruled by building, not by debate: build the `judge` leaf first
(smallest piece, ~40 lines over `postSystemOne`), keep loop runs for
wizards, deterministic tools untouched. The rung rule (fixed flow →
deterministic, one judgment → judge, conditional multi-step → loop)
is validated against evidence from building, starting with the first
crafted tool on a live site.
Blocked by: 01

## Question

A crafted tool needs judgment mid-flow (which row matches, is the
page usable, is this click reversible). Options: full loop runs per
invocation (today's `Kind: loop` in `looptools.go`), one typed
question per step (the proposed `judge` leaf over `postSystemOne` in
`jev.go:100`), or pure-deterministic tools with no judgment. Decide
where Jev lives, what it costs per invocation, and when plain CDP
tools beat Jev-assisted ones. Page JS can never hold a key
(`looptools.go:14`) — judgment stays CLI-side no matter what.
