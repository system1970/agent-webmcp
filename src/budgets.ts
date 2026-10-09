// Shared verb budgets. One block so windows/timeouts stay debated once.
export const LIST_WINDOW_MS = 4000
export const INVOKE_TIMEOUT_MS = 30000
// No single page call may pin a session past this; agents chunk instead.
export const INVOKE_TIMEOUT_MAX_MS = 300000
// A code run's own budget (it performs many calls); kill the worker past it.
export const RUN_TIMEOUT_DEFAULT_MS = 60000
// A run's budget ceiling, distinct from INVOKE_TIMEOUT_MAX_MS above: a
// 60s-default run that performs many 30s-capped calls needs headroom
// past any single call. Same value today, separate meaning.
export const RUN_TIMEOUT_MAX_MS = 300000
// Tool calls admitted per run; 25 keeps the worst case bounded (each
// call already time- and size-capped). Past it the run fails instead
// of throwing into code (same shape as @opencode/codemode's
// maxToolCalls — see docs/research/codemode-opencode-vs-cloudflare.md).
export const RUN_MAX_TOOL_CALLS = 25
// Agent code admitted per run; 64k chars holds generous blocks while
// keeping the structured-clone + compile step bounded. Past it the run
// fails pre-dial, same as empty code.
export const RUN_MAX_CODE_CHARS = 64000
// Final-value blast cap, enforced worker-side pre-clone: the host
// shapes + spills final values, but only after clone + stringify —
// past 8M chars the refuse happens in the worker instead of OOMing
// the host. Generous on purpose: the spill path keeps working for
// everything under it (64k–8M spills to disk, not failure).
export const RUN_MAX_DONE_CHARS = 8000000
// Unprivileged ports only; launch binds localhost.
export const PORT_MIN = 1024
export const PORT_MAX = 65535
// Per-result character budget (min/default/max) for execute/describe
// shaping. Shared so both doors clamp identically.
export const CHAR_BUDGET = { min: 1000, max: 64000, fallback: 8000 }
