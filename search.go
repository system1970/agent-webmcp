package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// find and lookup are the only commands that touch the network. They query
// the public webmcp.com directory: read-only JSON, no auth, no account. The
// browser loop (open/list/invoke/close) never leaves the machine.

const directoryBase = "https://webmcp.com"

type directoryError struct {
	code string
	msg  string
}

func (e *directoryError) Error() string { return e.msg }

// directoryGet fetches one directory endpoint and returns the raw body.
func directoryGet(ctx context.Context, path string, q url.Values, timeout time.Duration) ([]byte, error) {
	u := directoryBase + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "orkestrate/"+version)
	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("directory unreachable (" + err.Error() + "). find and lookup need the network; the browser loop stays local")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		var rl struct {
			RetryAfter int `json:"retryAfter"`
		}
		_ = json.Unmarshal(body, &rl)
		msg := "directory rate limit hit; try again later"
		if rl.RetryAfter > 0 {
			msg = fmt.Sprintf("directory rate limit hit; retry in ~%ds", rl.RetryAfter)
		}
		return nil, &directoryError{code: "rate_limited", msg: msg}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("directory returned HTTP %d for %s", resp.StatusCode, path)
	}
	if !json.Valid(body) {
		return nil, errors.New("directory response was not JSON")
	}
	return body, nil
}

func directoryFail(cmd string, err error) int {
	var de *directoryError
	if errors.As(err, &de) {
		return fail(de.code, de.msg)
	}
	return fail(cmd+"_failed", err.Error())
}

// --- wire shapes (subset used for human output; --json passes the raw body) ---

type directoryTool struct {
	Host        string `json:"host"`
	URL         string `json:"url"`
	SiteType    string `json:"siteType,omitempty"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Impl        string `json:"impl,omitempty"`
	Description string `json:"description,omitempty"`
}

type siteToolBrief struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Impl        string `json:"impl,omitempty"`
	Description string `json:"description,omitempty"`
}

type directorySite struct {
	Host string          `json:"host"`
	URL  string          `json:"url"`
	Type string          `json:"type"`
	Desc string          `json:"desc,omitempty"`
	Tools []siteToolBrief `json:"tools,omitempty"`
}

type lookupWire struct {
	OK          bool   `json:"ok"`
	Supported   bool   `json:"supported"`
	Host        string `json:"host"`
	MatchedHost string `json:"matchedHost,omitempty"`
	Platform    string `json:"platform,omitempty"`
	PlatformURL string `json:"platformUrl,omitempty"`
	ToolCount   int    `json:"toolCount,omitempty"`
	Message     string `json:"message,omitempty"`
	Site        *struct {
		Host      string          `json:"host"`
		URL       string          `json:"url"`
		Type      string          `json:"type"`
		Desc      string          `json:"desc,omitempty"`
		Category  string          `json:"category,omitempty"`
		ToolCount int             `json:"toolCount"`
		Tools     []siteToolBrief `json:"tools"`
	} `json:"site,omitempty"`
}

// --- helpers ---

func clip(s string, n int) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\n", " "))
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n < 2 {
		return string(r[:n])
	}
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

func kindTag(kind string) string {
	if kind == "" {
		return "?"
	}
	return "[" + kind + "]"
}

func validKind(k string) bool {
	return k == "answer" || k == "act" || k == "transact"
}

func validImpl(k string) bool {
	return k == "imperative" || k == "declarative"
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// --- find ---

type findOpts struct {
	query  string
	tool   string
	kinds  []string
	impl   string
	limit  int
	typeF  string
}

func parseFindArgs(rest []string) (findOpts, error) {
	o := findOpts{limit: 20}
	var positional []string
	for i := 0; i < len(rest); i++ {
		a := rest[i]
		next := func() (string, error) {
			if i+1 >= len(rest) {
				return "", errors.New("missing value for " + a)
			}
			i++
			return rest[i], nil
		}
		var err error
		switch {
		case a == "--tool":
			o.tool, err = next()
		case strings.HasPrefix(a, "--tool="):
			o.tool = strings.TrimPrefix(a, "--tool=")
		case a == "--kind":
			var v string
			if v, err = next(); err == nil {
				o.kinds = append(o.kinds, strings.Split(v, ",")...)
			}
		case strings.HasPrefix(a, "--kind="):
			o.kinds = append(o.kinds, strings.Split(strings.TrimPrefix(a, "--kind="), ",")...)
		case a == "--impl":
			o.impl, err = next()
		case strings.HasPrefix(a, "--impl="):
			o.impl = strings.TrimPrefix(a, "--impl=")
		case a == "--limit":
			var v string
			if v, err = next(); err == nil {
				o.limit, err = strconv.Atoi(v)
				if err != nil {
					return o, errors.New("--limit must be a number")
				}
			}
		case strings.HasPrefix(a, "--limit="):
			o.limit, err = strconv.Atoi(strings.TrimPrefix(a, "--limit="))
			if err != nil {
				return o, errors.New("--limit must be a number")
			}
		case a == "--type":
			o.typeF, err = next()
		case strings.HasPrefix(a, "--type="):
			o.typeF = strings.TrimPrefix(a, "--type=")
		case strings.HasPrefix(a, "-"):
			return o, errors.New("unknown find flag: " + a)
		default:
			positional = append(positional, a)
		}
		if err != nil {
			return o, err
		}
	}
	o.query = strings.TrimSpace(strings.Join(positional, " "))
	for _, k := range o.kinds {
		if !validKind(k) {
			return o, errors.New("--kind takes answer, act, or transact (got " + k + ")")
		}
	}
	if o.impl != "" && !validImpl(o.impl) {
		return o, errors.New("--impl takes imperative or declarative (got " + o.impl + ")")
	}
	if o.limit < 1 {
		o.limit = 20
	}
	if o.limit > 500 {
		o.limit = 500
	}
	if o.tool == "" && o.query == "" && len(o.kinds) == 0 && o.impl == "" {
		return o, errors.New("nothing to search for")
	}
	return o, nil
}

func runFind(ctx context.Context, rest []string, g globals) int {
	o, err := parseFindArgs(rest)
	if err != nil {
		return fail("usage", err.Error()+" — usage: orkestrate find <query> [--kind answer|act|transact] | find --tool <name>")
	}
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	if o.tool != "" {
		return runFindSites(ctx, o, timeout, g)
	}
	return runFindTools(ctx, o, timeout, g)
}

func runFindTools(ctx context.Context, o findOpts, timeout time.Duration, g globals) int {
	q := url.Values{}
	if o.query != "" {
		q.Set("q", o.query)
	}
	for _, k := range o.kinds {
		q.Add("kind", k)
	}
	if o.impl != "" {
		q.Set("impl", o.impl)
	}
	q.Set("limit", strconv.Itoa(o.limit))

	body, err := directoryGet(ctx, "/api/v1/tools", q, timeout)
	if err != nil {
		return directoryFail("find", err)
	}
	var wire struct {
		Count int             `json:"count"`
		Total int             `json:"total"`
		Tools []directoryTool `json:"tools"`
	}
	if err := json.Unmarshal(body, &wire); err != nil {
		return fail("find_failed", "unexpected directory shape: "+err.Error())
	}
	if g.json {
		ok(json.RawMessage(body))
		return 0
	}
	filter := ""
	if len(o.kinds) > 0 {
		filter = " (" + strings.Join(o.kinds, ", ") + ")"
	}
	if o.query != "" {
		fmt.Printf("find: %s for %q%s — showing %s of %d\n", plural(len(wire.Tools), "tool"), o.query, filter, strconv.Itoa(len(wire.Tools)), wire.Total)
	} else {
		fmt.Printf("find: %s%s — showing %s of %d\n", plural(len(wire.Tools), "tool"), filter, strconv.Itoa(len(wire.Tools)), wire.Total)
	}
	if len(wire.Tools) == 0 {
		fmt.Println("nothing matched — try a broader query, drop --kind, or: orkestrate lookup <url>")
		return 0
	}
	for _, t := range wire.Tools {
		fmt.Printf("  %-26s %-11s %-30s %s\n", clip(t.Name, 26), kindTag(t.Kind), clip(t.Host, 30), clip(t.Description, 90))
	}
	if wire.Total > len(wire.Tools) {
		fmt.Printf("  … %d more (raise --limit, max 500)\n", wire.Total-len(wire.Tools))
	}
	fmt.Printf("\nnext: orkestrate open %s --session demo\n", wire.Tools[0].URL)
	fmt.Println("note: --json includes input schemas. Directory record, not a live check — list after open.")
	return 0
}

func runFindSites(ctx context.Context, o findOpts, timeout time.Duration, g globals) int {
	q := url.Values{}
	q.Set("tool", o.tool)
	if o.query != "" {
		q.Set("q", o.query)
	}
	for _, k := range o.kinds {
		q.Add("kind", k)
	}
	q.Set("fields", "minimal")
	q.Set("limit", strconv.Itoa(o.limit))

	body, err := directoryGet(ctx, "/api/v1/sites", q, timeout)
	if err != nil {
		return directoryFail("find", err)
	}
	var wire struct {
		Count int             `json:"count"`
		Total int             `json:"total"`
		Sites []directorySite `json:"sites"`
	}
	if err := json.Unmarshal(body, &wire); err != nil {
		return fail("find_failed", "unexpected directory shape: "+err.Error())
	}
	if g.json {
		ok(json.RawMessage(body))
		return 0
	}
	fmt.Printf("find: %s with a tool matching %q — showing %s of %d\n", plural(len(wire.Sites), "site"), o.tool, strconv.Itoa(len(wire.Sites)), wire.Total)
	if len(wire.Sites) == 0 {
		fmt.Println("nothing matched — try a shorter substring, or: orkestrate find <query>")
		return 0
	}
	for _, s := range wire.Sites {
		names := make([]string, 0, len(s.Tools))
		for _, t := range s.Tools {
			names = append(names, t.Name)
		}
		fmt.Printf("  %-34s %-6s %-9s %s\n", clip(s.Host, 34), s.Type, plural(len(s.Tools), "tool"), clip(strings.Join(names, ", "), 80))
	}
	if wire.Total > len(wire.Sites) {
		fmt.Printf("  … %d more (raise --limit, max 500)\n", wire.Total-len(wire.Sites))
	}
	fmt.Printf("\nnext: orkestrate open %s --session demo\n", wire.Sites[0].URL)
	fmt.Println("note: --json includes input schemas. Directory record, not a live check — list after open.")
	return 0
}

// --- lookup ---

func runLookup(ctx context.Context, rest []string, g globals) int {
	var target string
	for _, a := range rest {
		if !strings.HasPrefix(a, "-") && target == "" {
			target = a
		}
	}
	if target == "" {
		return fail("usage", "usage: orkestrate lookup <url|host>")
	}
	q := url.Values{}
	if strings.Contains(target, "://") {
		q.Set("url", target)
	} else {
		q.Set("host", target)
	}
	body, err := directoryGet(ctx, "/api/v1/lookup", q, time.Duration(g.timeoutMs)*time.Millisecond)
	if err != nil {
		return directoryFail("lookup", err)
	}
	var wire lookupWire
	if err := json.Unmarshal(body, &wire); err != nil {
		return fail("lookup_failed", "unexpected directory shape: "+err.Error())
	}
	if g.json {
		ok(json.RawMessage(body))
		return 0
	}

	host := wire.Host
	if wire.MatchedHost != "" {
		host = wire.MatchedHost
	}
	switch {
	case wire.Site != nil:
		s := wire.Site
		fmt.Printf("lookup: %s → supported\n", host)
		meta := []string{s.Type}
		if s.ToolCount > 0 {
			meta = append(meta, plural(s.ToolCount, "tool"))
		}
		if s.Category != "" {
			meta = append(meta, s.Category)
		}
		if s.Desc != "" {
			fmt.Printf("  %s · %s\n", strings.Join(meta, " · "), clip(s.Desc, 120))
		} else {
			fmt.Printf("  %s\n", strings.Join(meta, " · "))
		}
		for _, t := range s.Tools {
			fmt.Printf("  %-22s %-11s %s\n", clip(t.Name, 22), kindTag(t.Kind), clip(t.Description, 100))
		}
		fmt.Printf("\nnext: orkestrate open %s --session demo\n", s.URL)
		fmt.Println("note: directory record, not a live check — list after open.")
	case wire.Platform == "shopify":
		fmt.Printf("lookup: %s → shopify platform match\n", host)
		if wire.ToolCount > 0 {
			fmt.Printf("  shared toolkit: %s\n", plural(wire.ToolCount, "tool"))
		}
		if wire.PlatformURL != "" {
			fmt.Printf("  schemas: %s\n", wire.PlatformURL)
		}
		fmt.Println("note: index match; the store may add tools. list after open.")
	default:
		fmt.Printf("lookup: %s → not in the directory\n", host)
		msg := wire.Message
		if msg == "" {
			msg = "no WebMCP tools registered for this host in the webmcp.com directory"
		}
		fmt.Println("  " + msg)
	}
	return 0
}
