# webmcp-protocol — result shapes, async effects, params, latency

Companion to the `agent-webmcp` skill core. Load when you need to parse a tool result, shape params, or reason about timing.

## How a call executes (Chrome 149–156 semantics)

Discovery is event-based — this Chrome range has no `listTools`. `list` enables the domain and collects `toolsAdded`. `invoke` sends exactly `{frameId, toolName, input: object}`, receives `{invocationId}`, and waits for the async `toolResponded` event (`Completed` → `output`, anything else → `errorText`). Duplicate tool names across frames require `--frame` (the `frameId` comes from `list`).

## Reading results

`invoke --json` returns `{ok, data:{tool, result}}` with the page's raw payload. Expect:

- `{content:[{type:"text", text:"..."}]}` — `text` is frequently **JSON-encoded**; parse it into values before reasoning, never quote it back.
- `structuredContent` next to `content` — prefer it for machine consumption (typed fields, pixel maps, SVGs, tables without prose parsing).
- Large outputs (telemetry, transcripts, per-pixel arrays) flood context. Narrow via the tool's own params where supported; otherwise filter locally (`--json` piped to `jq`) before reasoning over the payload.
- Non-`Completed` status carries the page's reason — adjust params, retry once, then report the refusal verbatim.

## Async effects

A `Completed` call means the page accepted the invocation, not that its effects landed. Patterns seen live: an `accepted` array echoing normalized tokens while animation plays out over seconds; a queue that drains (`queuedMoves: []`); counters (`moveCount`) and flags (`solved`) that advance after the return. The Procedure's verify step exists for this: the fresh readout is ground truth, the return is not.

## Params without quoting pain

`--params` takes a JSON **object** string. When the harness mangles quotes (PowerShell, some sandboxes), write a file and pass `--params @/tmp/p.json` (BOM-tolerant). `params must be a JSON object` means fix the quoting, not the call.

## Latency budget (measured, warmed, Windows + Chrome 152)

`status` ~27ms · `invoke` ~39ms · `list` ~343ms (300ms `toolsAdded` settle) · process-spawn floor ~15ms. Browser-side work inside `invoke` is ~4ms, so batching independent reads rarely pays — but never poll tight: invoke, wait on the page's own signal (queue empty, counter, flag), re-read.
