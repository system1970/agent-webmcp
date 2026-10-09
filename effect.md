# effect.md — how this repo uses Effect (law, not guide)

Pinned stable v4 (`effect@4.0.x` — the RC era ended with 4.0.2; re-pin
deliberately, never float). Sources: the v4 onboarding spine
(programs-as-values, typed errors, run-at-edge) and opencode's own
usage (services+layers at 200MB scale — noted, NOT imitated).

## Philosophy (the 30-second version)

An `Effect<A, E, R>` is a *value describing* a program: what it
returns, how it can fail, what it needs. Programs compose as values —
retry, timeout, parallelism are operators, not architectures. Two
consequences run this repo: failures live in the signature (no hidden
throws across a boundary), and execution happens at exactly one edge
per entrypoint (`src/main.ts:17`, the MCP request loop) — everything
inside is description.

## The two error kinds (no exceptions, literally and figuratively)

- **Failures** (expected, in `E`): `ToolFailed`, `CliFailure`,
  `TransportFailed`, `UsageError`, `TransientFailure` — all
  `Data.TaggedError`, all caught with `catchTag`, all agent-facing.
  Every `try`/`tryPromise` carries a `catch` mapping into one of
  these. Bare `UnknownError` never crosses a tool boundary.
- **Defects** (bugs, not in `E`): pass through untouched, loud by
  design. Never catch defects to continue domain logic; the edge
  (`runPromiseExit`) reports them.

## Allowed subset (everything else needs a reason comment)

- `Effect.gen` + `yield*` for sequencing; `Effect.succeed`/`fail`
  for values; `Effect.sync` for infallible thunks.
- `Effect.try`/`tryPromise` + `catch:` into a tagged error.
- `Effect.acquireRelease` for anything held across awaits
  (sockets, servers — see `mcp-serve.ts:66`).
- `Schema.Struct` + `decodeUnknownEffect` at every external boundary;
  `toInputSchema` derives MCP schemas — one schema is the truth.
- `Console.log`/`Console.error` for output. Never `console.*` in
  `src/` — under `mcp serve`, stdout is the protocol.

## Documented exemptions (live here, nowhere else)

- `Effect.callback` escape hatches (transport sockets, codemode worker):
  raw timers/continuations inside the hatch with settle guards; the
  hatch comment states what the scope owes and why it owes nothing.
- Past `runPromiseExit` the runtime has settled: `main.ts` edge uses
  raw process I/O by design. `Effect.runPromise` inside the MCP
  dispatch loop (`mcp-serve.ts:40`) is the same class — each request
  owns its fiber; do not "fix" by yielding into the loop fiber.

## Reference: opencode's usage (studied 2026-10-09, imitate shape)

Their scale justifies depth; ours borrows the shapes, not the weight:

- **Tool Def**: `{id, description, parameters, execute(args, ctx)}`
  with a rich `Context` (session, agent, abort signal, ask()). Decode
  closure hoisted once per tool init; failures map into a
  `Schema.TaggedErrorClass` whose `message` getter IS the
  model-facing prose (co-located, not rendered elsewhere — ours
  splits this; migrate when a failure file is next touched).
- **wrap**: every execute gets `Effect.orDie` + `Effect.withSpan`
  (telemetry per call). Spans need a provider — deferred to first
  real observability need, not 0.1.0.
- **Namespaces per module** (`export * as Tool`), staged pipelines
  returning discriminated unions (`{ok:true,value}|{ok:false,stage,
  error}`), one retry rule stated in a comment (their loader retries
  pre-import setup once — Bun caches failed imports otherwise).
- **Bootstrap**: domains expose `.node` layers, grouped once
  (`LayerNode.group`), provided with observability, run as a single
  `ManagedRuntime`. Our equivalent stays manual until the second
  implementation forces DI — but when it does, THIS is the shape.

## Refused (will be reverted on sight)

- Layers/Context/services for their own sake. Dependencies ride
  function arguments until a second implementation or a test double
  forces DI — that day has not come at 3.2k lines.
- `await` on a promise holding an effectful computation inside `gen`
  (breaks interruption); `yield*` the effect instead.
- Floating effects (un-yielded, unassigned) — the tsgo LSP flags them;
  treat its diagnostic as a gate failure by hand until tsgo lands.
- `effect/unstable/*` imports (v4 moved these to stability tags).
  Stable APIs only; an unstable import needs `allowedUnstableApis`
  plus a one-line reason, and dies in the next bump review.
- `any` in an error channel. `unknown` + narrow, or a tagged error.

## Setup (proper, per 2026-10-09 research)

- `effect@4.0.x` exact pin; source of truth is effect.website docs
  (v4) + the installed `node_modules/effect` (exact same bytes).
- `@effect/tsgo` + oxlint recommended preset: ADOPT PENDING the
  TypeScript-7-native cost evaluation. Until then, hand-enforce the
  floating-effect and stability-tag rules in review.
- `tsconfig.json`: `strict` stays on, `noEmit`, no new leniencies to
  accommodate Effect idioms — the code bends to the checker.
