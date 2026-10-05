package main

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

// Firefox/Zen cookie import.
//
// Zen (Firefox layout) keeps cookies in plaintext moz_cookies; Chromium
// wants AES-encrypted rows in its Cookies DB. The bridge: read Firefox
// rows, encrypt values with the Linux basic-store "peanuts" key, and
// INSERT into a Chromium Cookies DB that Chrome itself created (schema
// comes from the browser, never hand-written here). Profiles seeded
// this way launch with --password-store=basic (marker file), so the
// basic store — not the OS keyring — decrypts them.

// ffCookie is one Firefox/Zen cookie row.
type ffCookie struct {
	Host     string
	Name     string
	Value    string
	Path     string
	Expiry   int64
	IsSecure bool
	IsHTTP   bool
	SameSite int
}

// cdpParams renders the cookie as Storage.setCookies params. Session
// cookies omit expires; unknown sameSite stays unset (browser default).
func (c ffCookie) cdpParams() map[string]any {
	p := map[string]any{
		"name": c.Name, "value": c.Value, "domain": c.Host, "path": c.Path,
		"secure": c.IsSecure, "httpOnly": c.IsHTTP,
	}
	if c.Expiry > 0 {
		p["expires"] = float64(c.Expiry)
	}
	switch c.SameSite {
	case 1:
		p["sameSite"] = "Lax"
	case 2:
		p["sameSite"] = "Strict"
	}
	return p
}

// readFirefoxCookies dumps moz_cookies from a Firefox/Zen cookies.sqlite.
// Read-only: the source file is never written.
func readFirefoxCookies(path string) ([]ffCookie, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return nil, fmt.Errorf("bad_source: %v", err)
	}
	defer db.Close()
	rows, err := db.Query(`SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies`)
	if err != nil {
		return nil, fmt.Errorf("bad_source: no moz_cookies (%v)", err)
	}
	defer rows.Close()
	var out []ffCookie
	for rows.Next() {
		var c ffCookie
		var sec, http, same int
		if err := rows.Scan(&c.Host, &c.Name, &c.Value, &c.Path, &c.Expiry, &sec, &http, &same); err != nil {
			continue
		}
		c.IsSecure = sec != 0
		c.IsHTTP = http != 0
		c.SameSite = same
		out = append(out, c)
	}
	return out, rows.Err()
}

// setCookiesLive writes converted cookies into a running browser via
// Storage.setCookies. Chrome persists them to its own store itself —
// no SQLite surgery, no key handling, no launch dance.
func setCookiesLive(ctx context.Context, port int, fcs []ffCookie) (int, error) {
	var ver struct {
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := cdpGet(port, "/json/version", &ver); err != nil {
		return 0, fmt.Errorf("seed_failed: %v", err)
	}
	d, err := dialCDP(ctx, ver.WebSocketDebuggerURL)
	if err != nil {
		return 0, fmt.Errorf("seed_failed: %v", err)
	}
	defer d.Close()
	n := 0
	for _, fc := range fcs {
		if strings.TrimSpace(fc.Name) == "" {
			continue
		}
		if _, err := d.Call(ctx, "Storage.setCookies", map[string]any{"cookies": []any{fc.cdpParams()}}); err != nil {
			continue
		}
		n++
	}
	return n, nil
}
