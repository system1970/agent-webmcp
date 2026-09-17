package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

var errBadPort = errors.New("bad cdp port file")

// {ok,data|error,code} envelope. --json for machines, one line for humans.
var jsonOut = false

func ok(data any) {
	b, _ := json.Marshal(map[string]any{"ok": true, "data": data})
	fmt.Println(string(b))
}

func fail(code, msg string) int {
	if jsonOut {
		b, _ := json.Marshal(map[string]any{"ok": false, "code": code, "error": msg})
		fmt.Println(string(b))
	} else {
		fmt.Fprintf(os.Stderr, "error [%s]: %s\n", code, msg)
	}
	return 1
}

func failErr(code string, err error) int {
	return fail(code, err.Error())
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}
