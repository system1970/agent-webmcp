package main

import "strconv"

// ErrorCode is the machine-readable failure code surfaced in the
// `{ok:false, code, error}` envelope. Keep codes snake_case and stable:
// agents branch on them.
type ErrorCode string

const (
	ErrUsage              ErrorCode = "usage"
	ErrNoSession          ErrorCode = "no_session"
	ErrNoPage             ErrorCode = "no_page"
	ErrOpenFailed         ErrorCode = "open_failed"
	ErrListFailed         ErrorCode = "list_failed"
	ErrInvokeFailed       ErrorCode = "invoke_failed"
	ErrWebMCPUnsupported  ErrorCode = "webmcp_unsupported"
	ErrCDPUnreachable     ErrorCode = "cdp_unreachable"
	ErrEvalFailed         ErrorCode = "eval_failed"
	ErrRunFailed          ErrorCode = "run_failed"
	ErrRunStepFailed      ErrorCode = "run_step_failed"
	ErrToolCallLimit      ErrorCode = "tool_call_limit"
	ErrUnknownCommand     ErrorCode = "unknown_command"
	ErrUnknownSkill       ErrorCode = "unknown_skill"
	ErrCookiesFetchFailed ErrorCode = "cookies_fetch_failed"
	ErrStaleRef           ErrorCode = "stale_ref"
)

// parseInt parses a decimal integer flag value with a clear error.
// It never silently keeps the old value the way fmt.Sscanf did.
func parseInt(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// parsePositiveInt parses s and requires n > 0.
func parsePositiveInt(s string) (int, error) {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, err
	}
	if n <= 0 {
		return 0, strconv.ErrRange
	}
	return n, nil
}

// strField safely extracts a string field from an untyped JSON map.
// Page content is untrusted: missing or mistyped fields yield "", never panic.
func strField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	s, _ := m[key].(string)
	return s
}
