package main

import (
	"strings"
	"testing"
)

func TestSearchTokenize(t *testing.T) {
	got := searchTokenize("listStartups Page-Text *")
	want := []string{"list", "startups", "page", "text"}
	if len(got) != len(want) {
		t.Fatalf("tokenize = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("tokenize = %v, want %v", got, want)
		}
	}
}

func TestSearchTermForms(t *testing.T) {
	forms := searchTermForms("startups")
	found := map[string]bool{}
	for _, f := range forms {
		found[f] = true
	}
	if !found["startups"] || !found["startup"] {
		t.Fatalf("termForms = %v, want startups+startup", forms)
	}
}

func TestSearchScoreWeights(t *testing.T) {
	// Exact path segment (20) must beat substring-only rivals.
	exact := searchScore("tools.search", "find things", "tools.search\nfind things", [][]string{{"search"}})
	sub := searchScore("tools.researcher", "find things", "tools.researcher\nfind things", [][]string{{"search"}})
	if exact <= sub {
		t.Fatalf("exact %d should beat substring %d", exact, sub)
	}
	// Description-only (4) beats searchText-only (2).
	descOnly := searchScore("tools.xyz", "search the catalog", "tools.xyz\nsearch the catalog\nq", [][]string{{"catalog"}})
	if descOnly != 4+2 {
		t.Fatalf("desc+text score = %d, want 6", descOnly)
	}
	// Zero terms keep everything (empty query lists all).
	entries := []searchEntry{
		{Path: "tools.b", Description: "b", searchText: "tools.b"},
		{Path: "tools.a", Description: "a", searchText: "tools.a"},
	}
	page, remaining := rankSearch(entries, "", "", 10, 0)
	if len(page) != 2 || remaining != 0 || page[0].Path != "tools.a" {
		t.Fatalf("empty query should list all by path, got %+v", page)
	}
}

func TestRankSearchPaging(t *testing.T) {
	var entries []searchEntry
	for _, n := range []string{"c", "b", "a"} {
		entries = append(entries, searchEntry{Path: "tools." + n, Description: n + " tool", searchText: "tools." + n})
	}
	page, remaining := rankSearch(entries, "tool", "", 2, 0)
	if len(page) != 2 || remaining != 1 {
		t.Fatalf("page=%d remaining=%d, want 2/1", len(page), remaining)
	}
	page2, remaining2 := rankSearch(entries, "tool", "", 2, 2)
	if len(page2) != 1 || remaining2 != 0 {
		t.Fatalf("page2=%d remaining=%d, want 1/0", len(page2), remaining2)
	}
	// Scores order, not insertion order: query "b" ranks tools.b first.
	page3, _ := rankSearch(entries, "b", "", 10, 0)
	if page3[0].Path != "tools.b" {
		t.Fatalf("best match should lead, got %s", page3[0].Path)
	}
}

func TestRankSearchNamespace(t *testing.T) {
	entries := []searchEntry{
		{Path: "tools.a", Description: "a tool", Hosts: []string{"x.com"}, searchText: "a"},
		{Path: "tools.b", Description: "b tool", Hosts: []string{"y.com"}, searchText: "b"},
	}
	page, _ := rankSearch(entries, "tool", "y.com", 10, 0)
	if len(page) != 1 || page[0].Path != "tools.b" {
		t.Fatalf("namespace filter failed: %+v", page)
	}
}

func TestSearchPluralMatchesSingular(t *testing.T) {
	entries := []searchEntry{
		{Path: "tools.tinystartups_search", Description: "Search the catalog", searchText: "search catalog"},
	}
	page, _ := rankSearch(entries, "startups", "", 10, 0)
	if len(page) != 1 {
		t.Fatalf("plural query should match singular path, got %+v", page)
	}
	if !strings.Contains(page[0].Path, "search") {
		t.Fatalf("wrong hit: %+v", page)
	}
}
