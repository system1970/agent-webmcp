package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// crawl: the codemode v1 composition. Open + recon + WebMCP list +
// link/form harvest + auth probe in ONE invocation, one compact envelope
// out. Deterministic code does the crawling; Jev judges in a separate
// call (classify), never inside this one. Replaces N CLI round trips
// with one program — the Code Mode pattern (compose, don't turn-take).

// harvestJS collects links + forms in one eval. Bounded by construction
// (cap the collection, never slice the string — slicing mid-JSON
// silently voids the whole harvest on link-rich pages).
const harvestJS = `( () => {
  const links = {};
  let scanned = 0;
  for (const a of document.querySelectorAll('a')) {
    scanned++;
    if (Object.keys(links).length >= 80) continue;
    try {
      const h = new URL(a.href, location.href).pathname;
      if (h && h.length > 1 && h.length < 40 && !(h in links)) {
        const t = (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        links[h] = t;
      }
    } catch(err) {}
  }
  const forms = [...document.querySelectorAll('form')].map(f => ({
    action: f.action,
    fields: [...f.querySelectorAll('input,textarea,select')].filter(e => e.type !== 'hidden').length,
  }));
  const inputs = [...document.querySelectorAll('input,textarea,select')].filter(e => e.type !== 'hidden').length;
  return JSON.stringify({links, scanned, forms, inputs});
})()`

func crawlCmd(ctx context.Context, g *globals, rest []string) int {
	var url string
	for _, a := range rest {
		if !strings.HasPrefix(a, "-") && url == "" {
			url = a
		}
	}
	if url == "" {
		return fail("usage", "usage: agent-webmcp crawl <url> [--session NAME] [--json]")
	}
	if !strings.Contains(url, "://") && !strings.HasPrefix(url, "about:") && !strings.HasPrefix(url, "data:") {
		url = "https://" + url
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	r, err := openURL(ctx, g.session, url, g.chrome, g.headed, 30*time.Second)
	if err != nil {
		return failErr("open_failed", err)
	}
	t, err := sessionTarget(g.session, timeout)
	if err != nil {
		return failErr("no_page", err)
	}
	snap, _, err := captureSnapshot(ctx, g.session, timeout)
	if err != nil {
		return failErr("observe_failed", err)
	}
	controls, gates := 0, []string{}
	if raw, rerr := evalScript(ctx, t.WebSocketDebuggerURL, reconJS, timeout); rerr == nil {
		var inv struct {
			Controls []any    `json:"controls"`
			Gates    []string `json:"gates"`
		}
		if jerr := json.Unmarshal([]byte(raw), &inv); jerr == nil {
			controls, gates = len(inv.Controls), inv.Gates
		}
	}
	natives := []string{}
	if listed, _, lerr := listWebMCP(ctx, t.WebSocketDebuggerURL, timeout); lerr == nil {
		for _, tl := range listed {
			natives = append(natives, tl.Name)
		}
	}
	custom := []string{}
	for n := range customToolNames(g.session) {
		custom = append(custom, n)
	}
	links, forms, inputs, scanned, harvestErr := 0, []any{}, 0, 0, ""
	if raw, herr := evalScript(ctx, t.WebSocketDebuggerURL, harvestJS, timeout); herr == nil {
		var h struct {
			Links   map[string]string `json:"links"`
			Scanned int               `json:"scanned"`
			Forms   []any             `json:"forms"`
			Inputs  int               `json:"inputs"`
		}
		if jerr := json.Unmarshal([]byte(raw), &h); jerr == nil {
			links, forms, inputs, scanned = len(h.Links), h.Forms, h.Inputs, h.Scanned
		} else {
			harvestErr = "unmarshal"
		}
	} else {
		harvestErr = "eval"
	}
	out := map[string]any{
		"host": hostOfURL(snap.URL), "session": g.session, "profile": sessionProfile,
		"url": url, "final_url": snap.URL, "title": snap.Title,
		"text_chars": len(snap.Text), "actions": len(snap.Actions),
		"controls": controls, "gates": gates,
		"links_harvested": links, "links_scanned": scanned, "forms": forms, "inputs": inputs,
		"harvest_error": harvestErr,
		"native_tools":  natives, "custom_tools": custom,
		"login_wall": detectLoginWall(snap.URL, snap.Text),
		"reused":     r.Reused,
	}
	if g.json {
		ok(out)
		return 0
	}
	fmt.Printf("%s  (%d actions, %d links, %d forms, %d native tools, wall=%v)\n",
		snap.URL, len(snap.Actions), links, len(forms), len(natives), out["login_wall"])
	return 0
}
