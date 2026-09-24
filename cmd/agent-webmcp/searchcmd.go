package main

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

// searchcmd: the powerful catalog search. Ports opencode codemode's
// ranking verbatim (tokenize → singular forms → 20/8/4/2 field weights
// → score sort → limit/offset page with remaining/next), over our
// unified scope: registry (all hosts, stored descriptors) plus the
// session's live tools (native + injected, exact schemas) when a
// session is bound. Session entries win name collisions.
// Usage: agent-webmcp search <terms> [--session NAME] [--namespace HOST]
//   [--limit N] [--offset N] [--json]

var camelSplitRe = regexp.MustCompile(`([a-z0-9])([A-Z])`)
var termSplitRe = regexp.MustCompile(`[^a-z0-9]+`)

// searchTokenize mirrors codemode: camelCase split, lowercase, split on
// non-alphanumerics, drop empties and wildcards.
func searchTokenize(query string) []string {
	s := camelSplitRe.ReplaceAllString(query, "$1 $2")
	s = strings.ToLower(s)
	var out []string
	for _, term := range termSplitRe.Split(s, -1) {
		if term == "" || term == "*" {
			continue
		}
		out = append(out, term)
	}
	return out
}

// searchTermForms mirrors codemode: naive singulars so plural queries
// match singular index text.
func searchTermForms(term string) []string {
	forms := []string{term}
	if strings.HasSuffix(term, "es") && len(term) > 3 {
		forms = append(forms, term[:len(term)-2])
	}
	if strings.HasSuffix(term, "s") && len(term) > 2 {
		forms = append(forms, term[:len(term)-1])
	}
	return forms
}

// searchEntry is one rankable catalog row.
type searchEntry struct {
	Path        string         `json:"path"`
	Description string         `json:"description"`
	Kind        string         `json:"kind"`
	Hosts       []string       `json:"hosts,omitempty"`
	Required    []string       `json:"required"`
	Schema      map[string]any `json:"schema,omitempty"`
	Verified    bool           `json:"verified,omitempty"`
	searchText  string
}

// searchScore mirrors codemode weights: exact path segment 20, path
// substring 8, description substring 4, full search text 2 — summed
// across terms, any singular form matching.
func searchScore(path, desc, text string, terms [][]string) int {
	score := 0
	for _, forms := range terms {
		anyOf := func(f func(string) bool) bool {
			for _, form := range forms {
				if f(form) {
					return true
				}
			}
			return false
		}
		if anyOf(func(f string) bool { return path == f || strings.HasSuffix(path, "."+f) }) {
			score += 20
		}
		if anyOf(func(f string) bool { return strings.Contains(path, f) }) {
			score += 8
		}
		if anyOf(func(f string) bool { return strings.Contains(desc, f) }) {
			score += 4
		}
		if anyOf(func(f string) bool { return strings.Contains(text, f) }) {
			score += 2
		}
	}
	return score
}

// rankSearch filters (namespace + score>0 unless no terms), sorts by
// score desc then path, and pages. Returns page + remaining.
func rankSearch(entries []searchEntry, query, namespace string, limit, offset int) ([]searchEntry, int) {
	terms := searchTokenize(query)
	var forms [][]string
	for _, t := range terms {
		forms = append(forms, searchTermForms(t))
	}
	type ranked struct {
		e     searchEntry
		score int
	}
	var list []ranked
	for _, e := range entries {
		if namespace != "" {
			hit := false
			for _, h := range e.Hosts {
				if h == namespace || strings.HasSuffix(h, "."+namespace) {
					hit = true
					break
				}
			}
			if !hit {
				continue
			}
		}
		path := strings.ToLower(e.Path)
		desc := strings.ToLower(e.Description)
		score := searchScore(path, desc, e.searchText, forms)
		if len(terms) > 0 && score == 0 {
			continue
		}
		list = append(list, ranked{e: e, score: score})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].score != list[j].score {
			return list[i].score > list[j].score
		}
		return list[i].e.Path < list[j].e.Path
	})
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = 10
	}
	if offset > len(list) {
		offset = len(list)
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	out := make([]searchEntry, 0, end-offset)
	for _, r := range list[offset:end] {
		out = append(out, r.e)
	}
	return out, len(list) - end
}

func flagSearchLimit(rest []string) int {
	if v, ok := verbFlag(rest, "limit"); ok {
		if n, err := parseInt(v); err == nil && n > 0 && n <= 50 {
			return n
		}
	}
	return 10
}

func flagSearchOffset(rest []string) int {
	if v, ok := verbFlag(rest, "offset"); ok {
		if n, err := parseInt(v); err == nil && n >= 0 {
			return n
		}
	}
	return 0
}

// collectSearchEntries merges registry + live session tools. Session
// entries (exact live schemas) win name collisions.
func collectSearchEntries(ctx context.Context, session string, timeout time.Duration, withSession bool) ([]searchEntry, string, error) {
	byPath := map[string]searchEntry{}
	if all, err := loadCustomTools(); err == nil {
		for _, m := range all {
			kind := m.Kind
			if kind == "" {
				kind = "page"
			}
			desc := m.Desc
			if desc == "" && kind == "loop" {
				desc = "loop tool (bounded Jev run)"
			}
			req := m.Params
			if req == nil {
				req = []string{}
			}
			p := "tools." + m.Name
			byPath[p] = searchEntry{
				Path: p, Description: desc, Kind: kind, Hosts: m.Hosts,
				Required: req, Verified: m.Verified,
				searchText: strings.ToLower(p + "\n" + desc + "\n" + strings.Join(m.Hosts, "\n")),
			}
		}
	}
	pageURL := ""
	if withSession {
		t, err := sessionTarget(session, timeout)
		if err != nil {
			return nil, "", err
		}
		pageURL = t.URL
		tools, _, err := listWebMCP(ctx, t.WebSocketDebuggerURL, timeout)
		if err != nil {
			if isNotFound(err) {
				return nil, "", fmt.Errorf("webmcp_unsupported: browser has no WebMCP CDP domain (use Chrome 149+)")
			}
			return nil, "", err
		}
		tools = ensureCustomTools(ctx, session, t.WebSocketDebuggerURL, t.URL, timeout, tools)
		custom := customToolNames(session)
		for _, tl := range tools {
			kind := "native"
			if custom[tl.Name] {
				kind = "custom"
			}
			p := "tools." + tl.Name
			byPath[p] = searchEntry{
				Path: p, Description: firstLine(tl.Description), Kind: kind,
				Hosts: []string{hostOfURL(t.URL)}, Required: webmcpRequired(tl.InputSchema),
				Schema:     tl.InputSchema,
				searchText: strings.ToLower(p + "\n" + tl.Description),
			}
		}
	}
	var out []searchEntry
	for _, e := range byPath {
		out = append(out, e)
	}
	return out, pageURL, nil
}

func searchCmd(ctx context.Context, g *globals, rest []string) int {
	var terms []string
	for _, a := range rest {
		if !strings.HasPrefix(a, "-") {
			terms = append(terms, a)
		}
	}
	query := strings.Join(terms, " ")
	namespace, _ := verbFlag(rest, "namespace")
	if namespace != "" {
		namespace = normalizeHost(namespace)
	}
	limit := flagSearchLimit(rest)
	offset := flagSearchOffset(rest)
	// Explicit --session merges live tools (exact schemas win);
	// otherwise registry-only: global search needs no browser.
	timeout := time.Duration(g.timeoutMs) * time.Millisecond
	entries, pageURL, err := collectSearchEntries(ctx, g.session, timeout, g.sessionSet)
	if err != nil {
		return failErr("no_page", err)
	}
	page, remaining := rankSearch(entries, query, namespace, limit, offset)
	type item struct {
		Path        string         `json:"path"`
		Description string         `json:"description"`
		Kind        string         `json:"kind"`
		Hosts       []string       `json:"hosts,omitempty"`
		Required    []string       `json:"required"`
		Schema      map[string]any `json:"schema,omitempty"`
		Verified    bool           `json:"verified,omitempty"`
	}
	items := make([]item, 0, len(page))
	for _, e := range page {
		items = append(items, item{Path: e.Path, Description: e.Description, Kind: e.Kind, Hosts: e.Hosts, Required: e.Required, Schema: e.Schema, Verified: e.Verified})
	}
	next := any(nil)
	if remaining > 0 {
		next = map[string]any{"offset": offset + len(page)}
	}
	if g.json {
		data := map[string]any{"items": items, "remaining": remaining, "next": next}
		if pageURL != "" {
			data["url"] = pageURL
		}
		ok(data)
		return 0
	}
	if len(items) == 0 {
		fmt.Println("no tools match")
		return 0
	}
	for _, it := range items {
		fmt.Printf("%s (%s)\n  %s\n", it.Path, it.Kind, it.Description)
	}
	if remaining > 0 {
		fmt.Printf("+%d more (run: search --offset %d)\n", remaining, offset+len(page))
	}
	return 0
}
