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
}

func openURL(ctx context.Context, session, rawURL, chromeBin string, headed bool, timeout time.Duration) (*OpenResult, error) {
	port, reused, err := ensureChrome(session, chromeBin, headed, timeout)
	if err != nil {
		return nil, err
	}
	url := rawURL
	if url == "" {
		// No URL = attach: report the live tab.
		t, err := pickPageTarget(port)
		if err != nil {
			return nil, err
		}
		return &OpenResult{Session: session, URL: t.URL, Port: port, Headed: headed, Reused: true}, nil
	}
	targets, err := listTargets(port)
	if err != nil {
		return nil, err
	}
	var target Target
	for _, t := range targets {
		if t.Type == "page" && t.WebSocketDebuggerURL != "" {
			target = t
			break
		}
	}
	if target.WebSocketDebuggerURL == "" {
		if target, err = newPageTarget(port, url); err != nil {
			return nil, err
		}
		return &OpenResult{Session: session, URL: target.URL, Port: port, Headed: headed, Reused: reused}, nil
	}
	nctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	c, err := dialCDP(nctx, target.WebSocketDebuggerURL)
	if err != nil {
		return nil, err
	}
	defer c.Close()
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
		return nil, err
	}
	if _, err := c.Call(nctx, "Page.navigate", map[string]any{"url": url}); err != nil {
		return nil, err
	}
	select {
	case <-loaded:
	case <-time.After(3 * time.Second):
		// Soft timeout: SPAs keep loading; the URL is what matters.
	case <-nctx.Done():
		return nil, nctx.Err()
	}
	final := url
	if fresh, err := pickPageTarget(port); err == nil {
		final = fresh.URL
	}
	return &OpenResult{Session: session, URL: final, Port: port, Headed: headed, Reused: reused}, nil
}
