# users.md — who we build for

**Strangers** install and run this on machines we never see. Not us,
not this box, not localhost-with-our-Chromium. Every behavior must
survive a stranger's machine, and every risk must read cold in two
minutes. That is the whole perspective; the rest is procedure.

Read this when: adding or changing verbs/tools, changing errors, help,
or SKILL text, touching paths/ports/platforms/dependencies, or writing
an eval (fixtures must mirror the wild, not the lab).

## The stranger test (run it pre-commit on install-affecting diffs)

1. **Install cold.** Could a stranger install from docs alone, on a box
   you never touched? Done when: the website install path exists and
   was once followed blind. (No path yet — tracked, not built.)
2. **No my-machine.** No home dirs, usernames, assumed ports, assumed
   Chromium, assumed OS. Done when: preflight `user-surface` is green.
3. **Surface documented.** Every registry tool appears in SKILL.md —
   strangers discover tools there, not in source. Done when: preflight
   parity holds.
4. **Errors diagnose.** Every failure names its fix for someone with no
   repo access (`reason` + `fix`, the `TransportFailed` shape in
   `src/transport/errors.ts:6`). Done when: no new error lacks both.
5. **Disclosure reads cold.** The risk posture must survive a stranger
   who never reads past page one. Done when: `docs/run-accepted-risk.md`
   Distribution section still describes the code as-shipped.

## Per-machine vs distribution (the precise threat model)

Local install keeps the per-machine argument: each operator runs their
own agent on their own box — same privilege as their shell, no
cross-principal attack, no victim. Scale breaks four other things, and
only those four: cold disclosure (millions can't read the risk doc —
it must compress to install-time UX), heterogeneous machines (Chromium
floor, OS, paths), unattended runs (no human to confirm consequential
acts), and supply chain (binary provenance). Harden in that order;
nothing else earns machinery before a real deployment demands it.
