# How should an agent navigate and understand a page to craft a custom tool?

Type: research
Status: resolved

## Answer

Adopt the six-step craft workflow: goal+crawl → observe+explore →
draft (page JS or loop goal template) → `tools add` → `tools verify`
→ invoke smoke + record. Page tools for fixed sequences over stable
controls (deterministic, free); loop tools only when judgment is
required (wizards, conditional flows — page JS can't reach keys).
Validation bar: page tools must inject clean with every `ok:<tool>`
name in `webmcp list`; loop tools must terminate with `expect`
markers holding. Only verified tools auto-inject on `open`. Known
gaps vs webmcp-gen: no manifest/eval-report convention, no mandated
adversarial case, no per-tool invocation smoke in verify.

## Question

What is the best workflow for an agent to go from a bare URL to a
crafted custom WebMCP tool? Survey the outside pattern
(agent-browser `webmcp-gen` skill: explore → manifest → init script →
validate → eval report, declarative-first) against our machinery
(`observe` snapshot in `observe.go`, `crawl` recon in `crawl.go` +
`tools.go`, `tools verify` in `customtools.go`), and propose the
craft workflow: steps, artifacts, and the validation bar a tool must
clear before it joins the registry.
