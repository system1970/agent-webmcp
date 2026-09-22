package main

import (
	"context"
	"time"
)

type OpenResult struct {
	Session string `json:"session"`
	URL     string `json:"url"`
	Port    int    `json:"port"`
	Headed  bool   `json:"headed"`
	Reused  bool   `json:"reused"`
	Profile string `json:"profile"`
}

// openURL binds the session to a tab in the shared profile browser and
// navigates it. Headed is a launch property: when the live browser's
// headedness differs, the profile browser relaunches (tabs reset, the
// profile/cookies persist) and says so.
func openURL(ctx context.Context, session, rawURL, chromeBin string, headed bool, timeout time.Duration) (*OpenResult, error) {
	p := sessionProfile
	if port, err := profilePort(p); err == nil {
		var v map[string]any
		if cerr := cdpGet(port, "/json/version", &v); cerr == nil && profileHeaded(p) != headed {
			killProfileBrowser(p)
		}
	}
	t, created, err := bindSessionTab(ctx, session, rawURL, chromeBin, headed, timeout)
	if err != nil {
		return nil, err
	}
	port, _ := profilePort(p)
	if rawURL == "" {
		// No URL = attach: report the bound tab.
		return &OpenResult{Session: session, URL: t.URL, Port: port, Headed: profileHeaded(p), Reused: !created, Profile: p}, nil
	}
	if !created {
		// Fresh tabs open at the URL; bound tabs navigate.
		nctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		c, err := dialCDP(nctx, t.WebSocketDebuggerURL)
		if err != nil {
			return nil, err
		}
		loaded := make(chan struct{}, 1)
		go func() {
			for {
				select {
				case ev := <-c.events:
					if ev.Method == "Page.loadEventFired" {
						select {
						case loaded <- struct{}{}:
						default:
						}
						return
					}
				case <-nctx.Done():
					return
				}
			}
		}()
		if _, err := c.Call(nctx, "Page.enable", nil); err != nil {
			c.Close()
			return nil, err
		}
		if _, err := c.Call(nctx, "Page.navigate", map[string]any{"url": rawURL}); err != nil {
			c.Close()
			return nil, err
		}
		select {
		case <-loaded:
		case <-time.After(3 * time.Second):
			// Soft timeout: SPAs keep loading; the URL is what matters.
		case <-nctx.Done():
			c.Close()
			return nil, nctx.Err()
		}
		c.Close()
	} else {
		// Fresh tab: give the load a brief soft window.
		select {
		case <-time.After(1500 * time.Millisecond):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	final := rawURL
	if nt, err := sessionTarget(session, timeout); err == nil {
		final = nt.URL
	}
	return &OpenResult{Session: session, URL: final, Port: port, Headed: profileHeaded(p), Reused: !created, Profile: p}, nil
}
