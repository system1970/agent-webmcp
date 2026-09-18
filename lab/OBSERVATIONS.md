# Generalized Jev browser-use: observations from 8 real-site runs

Battery: Mintlify docs, books.toscrape pagination, HN comments, GitHub
(instant-DONE + file nav), BBC top story, Vercel docs, Wikipedia race
(~20 link hops). 7/7 DONE after fixes; 1 mid-battery failure analyzed.
Traces in `traces/*.jsonl`. Aggregate: Jev warm 400–1700ms here
(178ms upstream — region), conf 0.95–1.00 on clear tasks,
`done_p` ≥0.86 on true arrivals vs ≤0.17 mid-task (4b never rose
above 0.09 — the Noul gate is honest).

## 1. Decisions generalize; actuation doesn't
Jev chose correctly on every site first try (Confidence link 1.00,
"next" 0.99, "89 comments" disambiguation 0.99, performance.md 0.99,
AI Gateway 0.95). All 6 session bugs were in observe/act, zero in
decision policy. Invest in the executor, keep prompts stable.

## 2. Identity must be content-based, never positional
Index fallback misaligned on GitHub (dynamic rows) → clicked a README
tab instead of the file. Rule: resolve by stable key —
element-id → link-href → placeholder → name → index last.
Href matching fixed file nav (4b fail → 4c 2-step DONE).

## 3. Geometry: scroll first, measure second, retry offsets
`scrollIntoView(center)` AFTER measuring guarantees failure on
below-fold targets. Order: scroll → measure → hit-test; on
occlusion retry at -140px (sticky headers) then block:start+120.
Unreachable-after-retries → one gated JS click (visible-only).

## 4. Submit ladder for search fields
Raw Enter fails on framework widgets (Wikipedia Codex ignores
synthetic value+input). Ladder: real keystrokes (insertText) →
cooked Enter → `form.requestSubmit()` fallback. Never trust one
submit path. Also: Mercury needs max_tokens headroom (2048) —
reasoning eats small budgets whole (`finish_reason:length`).

## 5. Freshness + visited memory kill loops
Fingerprint must include field values or re-types read as no-change.
Track visited URLs in state with a no-revisit rule (broke the
Hip-hop ↔ Hip-hop-culture oscillation). Count stale outcomes toward
the stuck budget or fixation loops forever.

## 6. Gate terminals on confidence
Low-conf BLOCKED (0.39–0.43) is uncertainty, not impossibility:
re-decide once with BLOCKED unoffered + mandatory-explore rule.
Same for WAIT<0.6. High-conf DONE (≥0.86) verified correct 7/7;
threshold 0.7 held with margin.

## 7. Prefer navigation links over search boxes
Jev shortcut via visible nav (Vercel AI Gateway, wiki search→article)
3/3 times. Don't force search; offer both, let it choose.
For pure link races, remove TYPE_TEXT from the offered ops
(`--clicks-only`) rather than asking in prose.

## 8. Time is dominated outside Jev
Per 2–4 step task: nav 1–16s, observes ~30–200ms (2.4s outlier on
250-node hydrating pages), Jev ~0.4–1.7s, Mercury ~1–2.2s
(reasoning on), act ~0.2–3s. Speed program = warm HTTP/2 client,
URL-change poll before load-waits (4s cap, not 8s), settle-poll
until action count stabilizes on hydrating apps.
