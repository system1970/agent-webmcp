// Shared verb budgets. One block so windows/timeouts stay debated once.
export const LIST_WINDOW_MS = 4000
export const INVOKE_TIMEOUT_MS = 30000
// No single page call may pin a session past this; agents chunk instead.
export const INVOKE_TIMEOUT_MAX_MS = 300000
// Unprivileged ports only; launch binds localhost.
export const PORT_MIN = 1024
export const PORT_MAX = 65535
// Per-result character budget (min/default/max) for execute/describe
// shaping. Shared so both doors clamp identically.
export const CHAR_BUDGET = { min: 1000, max: 64000, fallback: 8000 }
