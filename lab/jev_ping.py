"""Jev speed baseline: single Choice vs speculative fan-out in one call.

Stdlib only. Key from env (never hardcoded):
    set -a; source ~/agent-webmcp/.env.local; set +a
    python3 jev_ping.py [--runs N]

Follows docs.typesafe.ai/api: state + questions map, answers keyed by
question id. Fan-out pattern: docs.typesafe.ai/patterns/fan-out —
extra questions run in parallel, ~no added latency.
"""

import json
import os
import sys
import time
import urllib.request

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = os.environ.get("TYPESAFE_MODEL", "jev-latest")
# Jev list price per docs/homepage: $0.042 / 1M input tokens, output free.
PRICE_PER_MTOK = 0.042


def post(body):
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not key:
        sys.exit("no_key: export TYPESAFE_API_KEY (set -a; source ~/agent-webmcp/.env.local; set +a)")
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            out = json.loads(resp.read().decode())
    except Exception as e:
        sys.exit(f"jev_failed: {e}")
    return out, round((time.perf_counter() - started) * 1000)


def cost_est(usage):
    try:
        return usage.get("input_tokens", 0) / 1e6 * PRICE_PER_MTOK
    except Exception:
        return 0.0


def single_choice():
    return {
        "model": MODEL,
        "state": {
            "page": {"url": "https://example.com/flights", "title": "Flights"},
            "elements": [
                {"index": "e1", "role": "combobox", "label": "Where from?"},
                {"index": "e2", "role": "combobox", "label": "Where to?"},
                {"index": "e3", "role": "button", "label": "Search"},
            ],
        },
        "questions": {
            "operation": {
                "type": "choice",
                "instructions": "Which browser operation advances the goal: find one-way Zurich to London flights?",
                "criteria": {
                    "CLICK": "Click a visible element.",
                    "TYPE_TEXT": "Enter text in an editable field.",
                    "WAIT": "Needed control is absent or results still loading.",
                },
            }
        },
    }


def fan_out():
    # Mirrors the browser loop: one operation Choice + speculative per-op
    # targets + independent goal_complete Noul, all over the same state.
    body = single_choice()
    body["questions"].update(
        {
            "click_target": {
                "type": "choice",
                "instructions": "If the next operation is CLICK, which element should it target?",
                "criteria": {"e3": "[e3] button Search"},
            },
            "type_text_target": {
                "type": "choice",
                "instructions": "If the next operation is TYPE_TEXT, which field should it target?",
                "criteria": {"e1": "[e1] combobox Where from?", "e2": "[e2] combobox Where to?"},
            },
            "goal_complete": {
                "type": "noul",
                "instructions": "Is the goal already satisfied by visible state: matching flight options visible?",
            },
        }
    )
    return body


def run_once(label, body):
    out, ms = post(body)
    usage = out.get("usage", {})
    answers = out.get("answers", {})
    op = answers.get("operation", {})
    summary = f"{label}: {ms}ms model={out.get('model')} "
    if isinstance(op, dict):
        summary += f"choice={op.get('choice')} conf={op.get('confidence')}"
    if "goal_complete" in answers and isinstance(answers["goal_complete"], dict):
        summary += f" done_p={answers['goal_complete'].get('noul')}"
    summary += f" in={usage.get('input_tokens')} out={usage.get('output_tokens')} est=${cost_est(usage):.6f}"
    print(summary)
    return ms


def main():
    runs = 3
    if "--runs" in sys.argv:
        try:
            runs = max(1, min(10, int(sys.argv[sys.argv.index("--runs") + 1])))
        except Exception:
            pass
    print(f"model={MODEL} runs={runs}")
    singles, fans = [], []
    for _ in range(runs):
        singles.append(run_once("single ", single_choice()))
    for _ in range(runs):
        fans.append(run_once("fan-out", fan_out()))
    med = sorted(singles)[len(singles) // 2]
    medf = sorted(fans)[len(fans) // 2]
    print(f"median single={med}ms fan-out={medf}ms delta={medf - med}ms")
    print("Expectation per fan-out pattern: delta near 0 despite 3 extra questions.")


if __name__ == "__main__":
    main()
