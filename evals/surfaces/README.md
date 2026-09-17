# Surface bench (evals/surfaces)

Deterministic regression corpus for the browser verbs (`scan`/`act`/`read`/
`wait`/`snapshot`) across tricky web surfaces, modeled on Stagehand's bench
task categories (shadow, iframe/oopif, roles, dynamic, forms).

- `*.html` — file:// fixtures (no network except the one cross-origin iframe
  in `frames.html`, which asserts the blocked-frame tally).
- `run.py` — opens each fixture in session `surf-bench`, asserts scan labels,
  frame tallies, act grounding (incl. closed-shadow `cbid` refs and nested
  `fp` paths), read text, and wait conditions; closes the session. Exit 0 =
  all pass.
- `run.cmd` — Windows wrapper (`python run.py`).

Run after touching `cmd/agent-webmcp/browse.go`, `snapshot.go`, or
`shadow.go`:

```cmd
cd evals\surfaces && run.cmd
```

Refs are resolved dynamically by (role, name) per run, so drawer/late state
changes don't brittle the checks. The closed-shadow `type` check asserts
`done:true` only — page JS cannot read back closed roots; strong verification
(documented in PR notes) used an independent CDP `resolveNode` read.
