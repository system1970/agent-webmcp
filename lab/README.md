# jev-lab — feel Jev speed in isolation

Jev dropped ~1 day ago. This folder isolates **Jev latency** from
**browser + text-helper overhead** so you can feel what's actually slow.

## Why Jev doesn't feel fast in a browser loop

From `browser-use/jev-ultrafast/docs/performance.md`:

- Median Jev call: **178ms** (17 calls per Flights task)
- Text helper (Mercury 2.5): **346–581ms** per field
- Browser protocol calls: **1,092 → 101** after optimization
- E2E Flights task: **7.073s** (includes loads, animations, stale retries)

Jev is fast. The loop around it (snapshot → decide → text → act →
re-observe → page load) is what you feel.

## Setup

```bash
set -a; source ~/agent-webmcp/.env.local; set +a  # provides TYPESAFE_API_KEY
python3 jev_ping.py            # raw Jev: 1 Choice, then fan-out
python3 jev_ping.py --runs 5   # more samples
```

Keys never go in this folder. See `.env.example`. `.env` is git-ignored.

## What to run next

1. `jev_ping.py` — baseline: single Choice vs speculative fan-out
   (operation + 3 targets + goal_complete in one call). Extra questions
   should add ~no latency per `docs.typesafe.ai/patterns/fan-out`.
2. Browser-loop breakdown — time `observe` / `decide` / `act` separately
   in `~/agent-webmcp` (`tick --goal ...`) and compare to ping numbers.
3. Confidence routing — see `docs.typesafe.ai/patterns/confidence-routing`
   (correct path is `confidence-routing`, not `confi…`): gate retries on
   margin/confidence instead of re-deciding blindly.

Skill: `typesafe-ai` (installed globally for OpenCode). Say
"use the TypeSafe skill" when experimenting.
