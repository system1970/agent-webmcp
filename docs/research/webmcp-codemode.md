# Research: WebMCP + codemode, and what they mean for agent-webmcp

Sources are primary: the spec repo ([webmachinelearning/webmcp](https://github.com/webmachinelearning/webmcp)),
its spec text (`index.bs`), and pi's own docs (`docs/codemode.md` in the
installed pi distribution). Section 4 is synthesis — marked as such.

## 1. WebMCP: what it is

WebMCP lets a page expose app functionality — JS functions or `<form>`
elements — as tools with natural-language descriptions and structured
schemas, for AI agent ingestion. Pages that use it act as in-page MCP
servers running client-side logic instead of backend APIs.
([README](https://github.com/webmachinelearning/webmcp/blob/main/README.md))

The point is client-side actuation without disintermediation: backend MCP
integrations bypass the page UI (context loss), force state/auth replication
onto a separate server, and make the developer write a backend to expose
client capabilities. WebMCP reuses the page's own code, keeps UI and agent
in shared state, and falls back gracefully — where page tools are absent,
agents may still use DOM/screenshot automation. The spec does not conflict
with that fallback. ([README](https://github.com/webmachinelearning/webmcp/blob/main/README.md))

Deliberately not adopted: the full backend MCP spec in the browser (no
origins, permissions, DOM, tab lifecycle; coupling to a moving protocol
hurts platform stability), static manifests alone (no dynamic tools, no
executable code), and event-only execution (schema drifts from
implementation). ([README alternatives](https://github.com/webmachinelearning/webmcp/blob/main/README.md))

## 2. The page API (spec: `index.bs`)

Three calls on `document.modelContext` (SecureContext only, gated by the
`"tools"` permissions policy):

```js
await document.modelContext.registerTool({ name, description, inputSchema, execute })
const tools = await document.modelContext.getTools()   // RegisteredTool[]
const result = await document.modelContext.executeTool(tool, { ...args }) // string
```

- `registerTool` rejects on duplicate names, empty name/description, or bad
  schema. Names: max 128 chars, `[A-Za-z0-9_.-]`. Options: `exposedTo`
  (origin allowlist) and `signal` (AbortSignal auto-unregisters).
  ([index.bs](https://github.com/webmachinelearning/webmcp/blob/main/index.bs))
- `getTools()` returns `{ name, title?, description, inputSchema, window,
  origin, annotations }` from the document and descendants exposed to it.
  The spec says this path is designed for **in-page JS agents (possibly in
  iframes)**; the browser's built-in agent uses a different internal
  mechanism. An external engine driving the page via CDP
  `Runtime.evaluate` is exactly an in-page JS caller.
  ([index.bs](https://github.com/webmachinelearning/webmcp/blob/main/index.bs))
- `executeTool` runs the tool on its owning document, resolves to the
  **stringified** result, omits input to mean `{}`. Cancel via
  `AbortSignal`. Lifecycle events: `toolchange`, `toolactivated`,
  `toolcancel`. ([index.bs](https://github.com/webmachinelearning/webmcp/blob/main/index.bs))
- Annotations on tools: `readOnlyHint` (default false),
  `untrustedContentHint`, `consequentialHint`, `debugging`. Note the
  vocabulary differs from MCP's (`readOnlyHint`, `destructiveHint`,
  `openWorldHint`) — a bridge must map, not copy.
  ([index.bs](https://github.com/webmachinelearning/webmcp/blob/main/index.bs))

Declarative side: `<form toolname tooldescription toolautosubmit>` becomes a
tool with a synthesized input schema. Results return via
`SubmitEvent#respondWith()` (no navigation) or JSON-LD extracted from the
landing page. Missing `toolautosubmit` means the agent fills the form and
the user submits manually.
([declarative-api-explainer.md](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md))

## 3. Implementation status (fetch date: 2026-10-08)

- Chrome 149: origin trial live. Local dev: `about:flags#enable-webmcp-testing`.
- Edge 150: origin trial live. ChatGPT Desktop: supported. Brave: experimental in Leo.
- Firefox / Safari: standards positions requested, no implementation.
  ([implementation-status.md](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md))

Engine consequence: a CDP-driven Chrome needs version ≥149 or the testing
flag passed at launch. This matches the Chrome floor already recorded for
the platform's setup prompt.

## 4. Best practices that bind our tool design

From the [spec README](https://github.com/webmachinelearning/webmcp/blob/main/README.md)
and [Chrome's guides](https://developer.chrome.com/docs/ai/webmcp/best-practices)
(linked there):

- **Budget**: every tool costs prompt tokens and latency; dozens+ degrade or
  get dropped. Dynamic register/unregister by page state (AbortSignal);
  static registration only for a handful of tools.
- **Trust the agent**: describe what the tool accomplishes, not procedural chains.
- **Raw input**: no mental math/timezone/string surgery by the model;
  normalize in code. Natural-language enums, described params.
- **Validate strictly in code, loosely in schema**: strict schema failures
  stall agents; `execute` validates and returns actionable errors for retry.
- **UI stays in sync**: agent and human share the session; visible state must
  reflect tool actions immediately.
- No `updateTool()`: metadata changes mean unregister + re-register (each
  fires `toolchange`, which list-refreshers observe).

## 5. Codemode (pi): the composition layer

From [pi's codemode docs](docs/codemode.md) (installed pi 1.1.0):

- Scripts are raw JS in a QuickJS sandbox (no fs/net/timers). Only the
  script's output reaches the model — so scripts fan out with
  `Promise.allSettled` and filter before returning.
- `tools.<name>(args)` calls any callable tool; MCP tools resolve to
  `CallToolResult` (`isError`, `structuredContent`). Failures reject —
  hence `allSettled`.
- Discovery without context cost: `searchTools()` (BM25), `describeTool()`,
  `describeNamespace()`, `ALL_TOOLS`. MCP tools default to `codemode`
  exposure: callable from scripts, undeclared to the model.
- `store()`/`load()` carry small JSON across calls. `models.classify()`
  renders typed judgments (choice/score/bool + confidence) over tool output.
- Limits: 256MB VM, no timers, no nested codemode, output caps with temp-file
  spillover.

## 6. Synthesis: what the engine must be (not spec — our design)

WebMCP defines the page side; codemode defines the composition side. The
engine is the missing middle — transport plus judgment:

- **Transport mirrors the spec's three calls.** Verbs should be
  open (CDP attach + navigate, flag on) → list (`getTools` via evaluate) →
  invoke (`executeTool` via evaluate) → verify (result + UI state) → close.
  Declarative forms need no special-casing: they surface through `getTools`.
- **Results stay structured.** `executeTool` returns a stringified result;
  the engine must parse and preserve it (JSON through, and
  `structuredContent` on our MCP side) so codemode scripts get values, not
  prose to re-parse.
- **Multi-call flows belong in one script.** get → filter → act sequences
  (the spec's own shopping/design examples) are `allSettled` + filter +
  return — the codemode pattern, not N model turns. Our MCP surface should
  assume script callers: small results, stable shapes, errors as data.
- **Judgment stays local.** Which tools to trust, when the page has none
  (DOM fallback), and verify-after-invoke are engine decisions — the same
  slot classifiers fill in pi. The spec intentionally leaves the agent side
  open; that gap is the product.
