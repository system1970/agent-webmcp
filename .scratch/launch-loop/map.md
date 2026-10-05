# Map: launch loop

`wayfinder:map` — now a build map. Building decides.

## Destination

agent-webmcp launches as a product whose core loop is: the agent
browses a site, crafts a custom WebMCP tool (deterministic core, Jev
judgment only where it earns it), validates it live, and reuses it
through codemode — proven by the 26-site demo with auth-vault logins.

## Notes

- Vocabulary in `AGENTS.md`; repo facts in `MAP.md`.
- Standing preferences: plain words, one site at a time, no feature
  earns its way in until a site blocks on it. Human types passwords;
  human approves submits.

## Build sections (in order)

- [ ] **1. Judge leaf.** One `judge` tool inside `execute` programs:
  typed choice/noul/score over redacted state, one call, answers
  with probabilities, counted in `max-calls`. Proves rung 2 exists.
- [ ] **2. Search inside execute.** In-program `search` over the tool
  registry (Cloudflare progressive discovery), so programs pull
  definitions instead of receiving the catalog.
- [ ] **3. First crafted tool, live.** Run the craft workflow
  (crawl → observe → draft → add → verify → smoke) on one real site.
  Evidence from this run locks the rung rule and the tier boundary.
- [ ] **4. Codemode over MCP.** Expose `execute` as an MCP tool once
  sections 1–2 are proven. Page results keep `untrusted` end to end.
- [ ] **5. Demo protocol.** Vault logins, submit approvals, per-site
  records, pass criteria — written from what sections 1–3 taught.
- [ ] **6. 26-site run.** Each site becomes a saved tool. The log is
  the launch demo.

## Decisions so far

- [How should an agent navigate and understand a page to craft a custom tool?](issues/01-craft-workflow.md): six-step workflow; page tools for fixed flows, loop tools only where judgment is needed; verified-only auto-inject.
- [Where does Jev live inside crafted tools?](issues/02-jev-in-tools.md): ruled by building — judge leaf first, loop runs for wizards, rung rule validated by evidence.

## Not yet specified

- Fill map (`--fill k=v`) and deterministic verbs: parked until a
  site blocks on them.
- Snapshot source (hand-rolled walk vs a11y tree), score/reversibility
  heads, confidence gate on every action: parked until loop data
  demands them.
- Release binaries, docs pass: after the 26-site run.

## Out of scope

- Zig port of the CLI; agent-to-agent work.
- WebMCP on Lightpanda (structurally absent, verified).
- Hosted gateway, billing, DB, MCP server in the orkestrate website.
