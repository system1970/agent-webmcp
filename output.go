package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// Envelope is the machine-readable output shape.
type Envelope struct {
	OK    bool   `json:"ok"`
	Code  string `json:"code,omitempty"`
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

var jsonOut = false

func printJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func ok(data any) {
	if jsonOut {
		printJSON(Envelope{OK: true, Data: data})
		return
	}
	// Human mode is handled by callers; fallback to JSON for structs.
	printJSON(Envelope{OK: true, Data: data})
}

func fail(code, msg string) int {
	if jsonOut {
		printJSON(Envelope{OK: false, Code: code, Error: msg})
	} else {
		fmt.Fprintln(os.Stderr, "error ["+code+"]: "+msg)
	}
	return 1
}

func failErr(code string, err error) int {
	return fail(code, err.Error())
}
