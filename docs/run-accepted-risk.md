# `run`: accepted-risk record

`run` executes agent-written JavaScript in a Bun worker with full
worker-realm capabilities. The containment is accident-only, stated in
`src/codemode/runner.ts:1`, locked by tests in
`src/codemode/runner.test.ts`, and disclosed to operators
(`skills/agent-webmcp/SKILL.md`) and MCP callers (the `run` tool
description). This note records the vectors we accept and what would
reopen the decision.

## Accepted vectors (all demonstrated live, all green tests)

Spelling list is non-exhaustive — the realm's reflective cores
(`Object`, `Reflect`, `Proxy`, `Array`, `JSON`, …) stay live by design,
so any equivalent spelling is the same accepted class:

1. Constructor escape: `({}).constructor.constructor("return typeof fetch")()`
   recovers live realm globals. The one-step spelling through bridged
   callables is DEAD — masked proxies expose no `.constructor` /
   `.prototype` / `.__proto__` / `.valueOf` and trap `getPrototypeOf`
   to null (each sub-path probed live, locked as tests) — but the `({})`
   long spelling survives by design (Proxy can't intercept literals),
   as do `Object`/`Reflect` spellings against literals.
   Param-shadowing cannot cover it (a fresh `Function` gets global
   scope, bypassing params).
2. Dynamic `import()`: `await import("node:fs")` returns live modules
   (`readFileSync` is a function). `import` is a keyword — unshadowable
   by the param trick, and the worker keeps full Bun module caps.
3. Forged completion: any `{type:"done"}` from the worker ends the run,
   and any `{type:"fail"}` fails it. A forged `done` is a return by
   another name; a forged `fail` is a `throw` by another name — no
   escalation for cooperating code, but the call cap doesn't constrain
   escaped code. (The run timeout DOES: host-side worker kill fires
   unconditionally. What it can't do is recall — see 4.) Mitigations
   that stand: over-budget finals AND failure messages fail closed
   host-side too (`RUN_MAX_DONE_CHARS`), so a forged giant fails
   instead of OOMing the host. The structured-clone of a forged value
   itself (pre-gate) is accepted cost, same class as the channel.
   Correction to an earlier draft: forged `result` messages are NOT a
   vector — worker→host traffic the host doesn't solicit (`done` /
   `fail` / `call` are the only handled types) is dropped, and the
   worker's own waiters only resolve on host→worker replies.
4. Spawn outlives the kill: with full Bun caps, `await import(...)`
   reaches `node:child_process` and `Bun.spawn` — detached processes
   survive `worker.terminate()`. Same accepted single-operator class
   (your agent spawning processes is what your shell does); stated
   here so the kill-path "honest leak" note (page calls landing
   post-timeout) isn't read as the only survivor.

## Why accepted

The code is the operator's OWN agent: same privilege as their shell,
same as harness codemode (pi codemode, opencode Code Mode) running on
their machine. There is no cross-principal attack — no victim, no
escalation. True isolation (seccomp userns, dedicated uid, no-net
worker) would cost a platform layer Unit 6 explicitly deferred, for a
threat that doesn't exist in single-operator use.

## What the worker still buys

Denied-name shadowing (incl. bridge internals `__nextId`/`__pending`),
runaway kills (timeouts terminate the worker), invoke-call caps,
per-result ceilings on every bridge op plus the final value, fail-before-dial
validation, defect-loudness. Multi-session runs return `origins[]`
(the contributor list — honest, not cryptographic lineage) alongside
per-session call counts. Accidents contained; malice out of scope.

## What reopens this

- Multi-tenant or multi-author code (untrusted third parties writing
  `run` blocks): re-evaluate gating (opt-in flag) or real isolation.
- MCP exposed beyond localhost to untrusted clients: same.
- A Bun worker permission API landing: adopt it (least-privilege is
  free when the platform offers it).

Until then: containment claims stay in comments/tests/docs, boundary
claims stay out.

## Considered and rejected: a `done`-message nonce

A per-run secret checked on `done`/`fail` would close forgery cheaply,
but any code forging `done` can equivalently `return` (and `fail` ≡
`throw`) — machinery with zero threat-model value. Revisit only with
multi-tenant use.
