# What is the codemode shape for WebMCP tools?

Type: grilling
Status: resolved

## Answer
Superseded by the build map: this decision is made by building (map.md sections 1–6), not by debate.

## Question

`execute` already runs programs over live page tools plus loop tools
(`sessionExecCatalog` in `execmode.go:191`), with `batch()` capped at
8 and sandbox rules in `execmode.go:20`. Cloudflare's Code Mode adds
progressive discovery (`search` + `describe` inside the program) so
the model pulls definitions instead of receiving the catalog. Decide
the shape: does `execute` gain in-program `search`/`describe`, what
the program-visible tool surface is (page tools + crafted tools +
loop tools?), and the budget rules that keep programs bounded.
