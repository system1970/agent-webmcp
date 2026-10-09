# decisions.md — settled scope, final

One-liners with reason + date. Reviewer reads this first; re-litigation
without new evidence is out of scope. New rows need owner approval.

- No opt-in gate on code execution (single-operator localhost): accident
  containment + accepted-risk record is the posture; sandboxing is
  speculative until multi-tenant serve. 2026-10-09, final.
  `docs/run-accepted-risk.md:1`, `src/codemode/runner.ts:1`
- Commits split by concern (law → serve fix → units); `reviews/` records
  stay gitignored local-only. 2026-10-09, final. `scripts/review.ts:29`
- Nonce rejected with reason: forgery ≡ return/throw, so forged
  finals/failures are size-gated host-side instead. 2026-10-09, final.
  `src/codemode/runner.ts:1`
- 7-verb surface; code-only `execute` merged the old batch + `run`
  (Unit 7); no new verbs without a unit. 2026-10-09, final.
  `src/tools/registry.ts:8`, `src/tools/execute.ts:1`
- `--handle` stays accepted as alias wherever `--session` exists
  (search + execute CLI); dropping it is a compat break, not cleanup.
  2026-10-09, final. `src/commands/execute.ts:23`
- Research docs are timestamped point-in-time; exempt from file:line
  freshness (mark pre-merge paths, don't chase them). 2026-10-09, final.
  `docs/research/cross-page-composition.md:40`
- Evals assert shapes and bounded races, never exact values or timings
  (machine variance makes thresholds flaky or meaningless). 2026-10-09,
  final. `scripts/eval-sessions.ts:103`
- Preflight (map/help/envelope/check/test) governs what scripts can
  check; reviewer governs judgment only. 2026-10-09, final.
  `scripts/preflight.ts:1`
- Single-operator assumption LIFTED 2026-10-09: prior "final until
  multi-tenant" rows become ordered roadmap, riskiest first. New code
  passes the stranger test (`docs/users.md`); the per-machine analysis
  stands, distribution consequences are new work. Owner-ordered.
- Docs freeze until users: one-in-one-out for new doc files (decisions,
  learnings, users, risk, research suffice). Website install path
  exempt — product surface, not process. 2026-10-09.
