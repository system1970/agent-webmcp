package main

import "testing"

func TestNormalizeTarget(t *testing.T) {
	if normalizeTarget("@e24") != "e24" {
		t.Fatal("@ prefix not stripped")
	}
	if normalizeTarget("e24") != "e24" {
		t.Fatal("bare id changed")
	}
	if normalizeTarget("tinystartups_search") != "tinystartups_search" {
		t.Fatal("tool name changed")
	}
}
