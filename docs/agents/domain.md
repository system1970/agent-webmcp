# Domain docs

Single-context layout.

- Vocabulary lives in `AGENTS.md` (verb, tool, judgment, receipt, gate).
- Repo facts live in `MAP.md` (every fact names a file and a line).
- No `CONTEXT.md`; create one at the repo root only when the first
  cross-cutting term needs pinning outside `AGENTS.md`.
- No `docs/adr/`; create it when the first hard-to-reverse,
  surprising-without-context trade-off lands.
