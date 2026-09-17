package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// Envelope is the machine-readable output shape.
type Envelope struct {
	OK    bool      `json:"ok"`
	Code  ErrorCode `json:"code,omitempty"`
	Data  any       `json:"data,omitempty"`
	Error string    `json:"error,omitempty"`
}

var jsonOut = false

func printJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// ok prints a success envelope. All commands use this shape so agents
// can branch on `ok` without scraping human text.
func ok(data any) {
	printJSON(Envelope{OK: true, Data: data})
}

func fail(code ErrorCode, msg string) int {
	if jsonOut {
		printJSON(Envelope{OK: false, Code: code, Error: msg})
	} else {
		fmt.Fprintln(os.Stderr, "error ["+string(code)+"]: "+msg)
	}
	return 1
}

func failf(code ErrorCode, format string, args ...any) int {
	return fail(code, fmt.Sprintf(format, args...))
}

func failErr(code ErrorCode, err error) int {
	if err == nil {
		return fail(code, string(code))
	}
	return fail(code, err.Error())
}
