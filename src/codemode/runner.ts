import { Effect, Fiber } from "effect"
import { RUN_MAX_CODE_CHARS } from "../budgets.ts"

// Accident-contained code runner: agent JS executes in a Bun Worker whose only
// INTENDED capability is a message bridge back to the host. Accident
// containment, not a security boundary — stated plainly because the
// code is the operator's OWN agent (same privilege as their shell):
// a recovered constructor (`({}).constructor.constructor(...)`) still
// runs in the worker realm, which keeps full Bun caps. The bridge
// itself is the deliberate channel (invoke → page tools, some of them
// consequential), and page text flowing into code is untrusted input
// to the agent's own logic. Corollary, locked as a test: escape also
// permits forged completion (a `done` message is a return by another
// name), so the call cap binds cooperating code — it doesn't constrain
// escaped code. The run timeout is different: host-side worker kill
// fires unconditionally (escaped code dies with the worker), but it
// recalls nothing already dispatched — page calls and spawned
// processes outlive the kill. Same class: `import` is a keyword, not
// shadowable by the param trick, so `await import("node:fs")` runs with
// full worker caps. Named here so the containment list stays complete:
// denied names, runaways, call cap — plus these two known holes. What
// the worker gives: no accidental access to the listed vectors
// (timers, net, host, bridge internals arrive as explicit undefined
// params, not deletable globals — the list is enumerated in
// DENIED_GLOBALS, not exhaustive: performance/crypto and friends
// stay live by design — CPU/mem/noise, no capability), killed runaways
// (timeouts terminate the worker),
// and capped blasts (invoke-call limit). Single-source DENIED_GLOBALS
// below feeds both the param shadow and the call args — they cannot
// drift apart by hand-counting.
//
// Values cross as structured clones — functions die at the boundary
// with a clear error. Mirrors opencode @opencode/codemode's shape
// (restricted subset, copied values, tool-call caps; see
// docs/research/codemode-opencode-vs-cloudflare.md) without its
// interpreter: the realm boundary is the containment.
//
// Multi-session: one run binds N sessions under caller aliases. Each
// alias carries a frozen tool snapshot (same benign fail directions,
// per alias); budgets stay global (one 25-call cap, one run timeout).
// Returns carry origins[] — the contributor list, honest but not
// cryptographic lineage. Callers bind bare tools/search/describe to
// exactly one session; multi-session code addresses sesh.ALIAS.tools.

export interface RunSessionSnapshot {
  readonly handle: string
  readonly origin: string
  readonly tools: Array<{
    readonly name: string
    readonly description: string
    readonly inputSchema: unknown
    readonly annotations: unknown
  }>
}

export interface RunResult {
  readonly value: unknown
  readonly toolCalls: number
  readonly perSession: Record<string, number>
  readonly origins: Array<string>
}

// One list feeds both the `new Function` param shadow and the
// `undefined` call args in the prelude below — single source, no
// hand-counted drift (a dropped name would silently restore a global).
export const DENIED_GLOBALS: ReadonlyArray<string> = [
  "Function", "eval",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "queueMicrotask", "setImmediate", "clearImmediate",
  "fetch", "importScripts", "WebSocket", "XMLHttpRequest",
  "EventSource", "Worker", "BroadcastChannel",
  "process", "Bun", "require", "module", "exports",
  "__dirname", "__filename",
  "postMessage", "onmessage", "self", "globalThis",
  // Realm aliases: Bun exposes Node `global` (a live backdoor to
  // fetch/process with no escape) and `navigator`. `window` doesn't
  // exist in the realm (probed) but stays listed so a platform change
  // turns the audit test red instead of silently opening a backdoor.
  "global", "navigator", "window",
  // console: a worker console.log forwards to host stdout — the MCP
  // wire under `mcp serve`. Shadowing kills the noisiest accident
  // vector in the whole list; debugging happens via return values.
  "console",
  // Bridge internals: __pending/__nextId live on worker-global scope
  // (they must — the result branch needs them across messages), so
  // shadow them too. Otherwise cooperating code could clear pending
  // calls or skew ids — a self-DoS, but no reason to leave it open.
  "__nextId", "__pending"
]

const declareDenied = DENIED_GLOBALS.map((n) => `"${n}"`).join(", ")
const passDenied = DENIED_GLOBALS.map(() => "undefined").join(", ")

const WORKER_PRELUDE = `
let __nextId = 1;
const __pending = new Map();
onmessage = (ev) => {
  const m = ev.data;
  if (m && m.type === "result") {
    const r = __pending.get(m.id);
    if (r !== undefined) { __pending.delete(m.id); r(m); }
    return;
  }
  if (!m || m.type !== "start") return;
  const __call = (op, payload) => new Promise((resolve, reject) => {
    // Request cap, mirroring the result caps: measure pre-postMessage
    // so a giant args object fails catchable here instead of cloning
    // to the host and dialing CDP. Strings measure free; the check
    // costs ~delivery order for objects. Unserializable rejects loud.
    let size = -1;
    let unmeasurable = false;
    try { size = JSON.stringify(payload)?.length ?? -1; unmeasurable = size < 0; } catch (e) { unmeasurable = true; }
    if (unmeasurable) { reject(new Error("request is not JSON-measurable (circular or BigInt?): simplify the args.")); return; }
    if (size > m.maxResultChars) { reject(new Error("request exceeds per-call budget (" + m.maxResultChars + " chars): chunk the args.")); return; }
    const id = __nextId++;
    __pending.set(id, resolve);
    // Spread FIRST: envelope keys win over any present/future payload
    // key (payload today is tool/args/query/name — no collision — but
    // authority must not depend on that). Spread also defines own
    // properties where bracket-assign would invoke the __proto__ setter.
    postMessage({ ...payload, type: "call", id: id, op: op });
  });
  const checked = (p) => p.then((m) => {
    if (!m.ok) throw new Error(m.message);
    return m.value;
  });
  const mask = (fn) => new Proxy(fn, {
    get: function (t, name) {
      // One-step escape killed here: bridged callables expose no
      // .constructor/.prototype/.__proto__/.valueOf — each is a live-
      // Function path (probed: __proto__.constructor, valueOf().constructor).
      // getPrototypeOf is trapped below for the same reason. (The
      // ({}).constructor long spelling survives by design — accepted,
      // locked as a test. Proxy itself can't be denied.)
      if (name === "constructor" || name === "prototype" || name === "__proto__" || name === "valueOf") return undefined;
      const v = t[name];
      return typeof v === "function" ? v.bind(t) : v;
    },
    getPrototypeOf: function () { return null; },
    apply: function (t, th, args) { return t.apply(th, args); }
  });
  const boundTools = (alias) => new Proxy({}, {
    get: function (_, name) {
      if (name === "then" || name === "constructor" || name === "prototype" || name === "__proto__" || name === "valueOf") return undefined;
      return mask(function (args) { return checked(__call("invoke", { session: alias, tool: String(name), args: args === undefined ? {} : args })); });
    },
    getPrototypeOf: function () { return null; }
  });
  const tools = m.defaultAlias === null ? new Proxy({}, {
    get: function () { throw new Error("multi-session run: use sesh.ALIAS.tools.<name> (bare tools need exactly one bound session)"); },
    getPrototypeOf: function () { return null; }
  }) : boundTools(m.defaultAlias);
  // Multi-session addressing: sesh.ALIAS.tools.<name> routes to that
  // session; sesh.ALIAS.search filters merged hits to it;
  // sesh.ALIAS.describe pins it. Unknown aliases read undefined (the
  // host refuses forged ones anyway). Global search spans all bound
  // sessions; global describe takes an optional session.
  // Null-prototype map (not {}): caller aliases share this namespace
  // and __proto__ must never resolve through inheritance here.
  const KNOWN = Object.create(null);
  for (const a of m.sessions) KNOWN[a] = true;
  const sesh = new Proxy({}, {
    get: function (_, alias) {
      if (typeof alias !== "string" || !KNOWN[alias]) return undefined;
      return {
        tools: boundTools(alias),
        search: (query) => search(query).then((hits) => hits.filter((h) => h.session === alias)),
        describe: (name) => describe(name, alias)
      };
    },
    getPrototypeOf: function () { return null; }
  });
  const search = mask((query) => checked(__call("search", { query: String(query) })));
  const describe = mask((name, session) => checked(__call("describe",
    session === undefined ? { name: String(name) } : { name: String(name), session: String(session) })));
  const settle = (ok, value, message) => {
    // Final-value blast cap, worker-side pre-clone: the host shapes +
    // spills, but only AFTER clone + stringify — a 500M-char done would
    // OOM the host first. Strings (the repeat() vector) measure free;
    // objects pay stringify-to-measure, same order as delivery itself.
    // Unmeasurable values fall through to the clone attempt below,
    // which fails LOUD (never silent, never a timeout mystery).
    if (ok) {
      // Fail closed on unmeasurable too (circular, BigInt): clearer
      // than dying ambiguously at the clone below.
      let size = -1;
      let unmeasurable = false;
      try {
        size = typeof value === "string" ? value.length : (JSON.stringify(value) || "").length;
      } catch (e) {
        unmeasurable = true;
      }
      if (unmeasurable) {
        try {
          postMessage({ type: "fail", message: "result is not JSON-measurable (circular or BigInt?): simplify the return." });
        } catch (e2) {}
        return;
      }
      if (size >= 0 && size > m.maxDoneChars) {
        try {
          postMessage({ type: "fail", message: "result exceeds final budget (" + m.maxDoneChars + " chars): chunk the read." });
        } catch (e2) {}
        return;
      }
    }
    // Unclonable values (functions, symbols) throw DataCloneError HERE,
    // inside the worker — caught into a fail, never a 60s timeout mystery.
    try {
      postMessage(ok ? { type: "done", value: value } : { type: "fail", message: message });
    } catch (e) {
      try {
        postMessage({ type: "fail", message: "unserializable value: " + String(e && e.message || e) });
      } catch (e2) { /* worker is dead to us; host timeout owns diagnosis now */ }
    }
  };
  let fn;
  try {
    fn = new Function("tools", "search", "describe", "sesh",
      ${declareDenied},
      "return (async () => {\\n" + m.code + "\\n})()");
  } catch (e) { settle(false, 0, "compile: " + String(e && e.message || e)); return; }
  let p;
  try {
    p = fn(tools, search, describe, sesh,
      ${passDenied});
  } catch (e) { settle(false, 0, String(e && e.message || e)); return; }
  Promise.resolve(p).then(
    function (v) { settle(true, v === undefined ? null : v, ""); },
    function (e) { settle(false, 0, String(e && e.message || e)); }
  );
};
`

export const runCode = Effect.fn("codemode.run")(function* (input: {
  code: string
  // One entry per bound session, keyed by caller alias. Snapshots are
  // frozen per alias at start (same benign fail directions, ×N).
  sessions: Record<string, RunSessionSnapshot>
  // Bare tools/search/describe bind here. Callers set it iff exactly
  // one session is bound; multi-session code uses sesh.ALIAS.*.
  defaultAlias?: string
  // Page dispatch per alias (handle lookup + budgets live here, so the
  // worker never sees ports or timeouts; session aliases/handles do
  // ride search hits and describe records by design — same operator
  // privilege, not secrets).
  dispatch: (alias: string, tool: string, args: Record<string, unknown>) => Effect.Effect<unknown, { message: string }>
  timeoutMs: number
  maxToolCalls: number
  maxResultChars: number
  maxDoneChars: number
}) {
  const aliases = Object.keys(input.sessions)
  if (aliases.length === 0) {
    return yield* Effect.fail({ message: "no sessions bound: caller contract needs at least one." })
  }
  if (input.defaultAlias !== undefined && !Object.hasOwn(input.sessions, input.defaultAlias)) {
    return yield* Effect.fail({ message: `bad defaultAlias '${input.defaultAlias}': not a bound session.` })
  }
  // Alias shape enforced at the boundary that builds the `sesh`
  // namespace — not just the tool lane. Prototype-chain names would
  // confuse routing with inheritance; non-identifiers break
  // sesh.ALIAS access. Same rule as the tool lane, locked twice.
  for (const alias of aliases) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(alias) || alias === "__proto__" || alias === "constructor" || alias === "prototype") {
      return yield* Effect.fail({ message: `bad session alias '${alias}': want a plain identifier, not a prototype-chain name.` })
    }
  }
  if (input.code.trim().length === 0) {
    return yield* Effect.fail({ message: "code is empty." })
  }
  if (input.code.length > RUN_MAX_CODE_CHARS) {
    return yield* Effect.fail({ message: `code is ${input.code.length} chars (max ${RUN_MAX_CODE_CHARS}): chunk the block.` })
  }
  // Boundaries below this point are the tool's contract (tools/execute.ts
  // validates timeout range and call/result/done budgets before dialing).
  // Only the platform truth the tool never checks stays here: libuv
  // setTimeout past 2^31-1ms overflows (fires immediately), so a direct
  // caller passing a huge timeout gets a loud refusal instead of an
  // instant-timeout mystery. (Code-length wording matches the tool's;
  // timeout wording is runner-specific.)
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 2147483647) {
    return yield* Effect.fail({ message: `bad timeoutMs '${input.timeoutMs}': want a positive integer at most 2147483647 ms.` })
  }
  return yield* Effect.callback<RunResult, { message: string }>((resume) => {
    let worker: Worker
    let blobUrl = ""
    try {
      blobUrl = URL.createObjectURL(new Blob([WORKER_PRELUDE], { type: "text/javascript" }))
      worker = new Worker(blobUrl)
    } catch (cause) {
      // Worker construction failed after the blob was allocated (or
      // during): revoke what we hold — finish/cleanup never registered.
      try {
        if (blobUrl !== "") URL.revokeObjectURL(blobUrl)
      } catch {}
      resume(Effect.fail({ message: `cannot start sandbox worker: ${String(cause)}` }))
      return
    }
    let calls = 0
    let settled = false
    // Per-alias call counts (envelope) + first-dispatch order (origins
    // contributor list). Both count invoke ATTEMPTS including snapshot
    // misses (misses consume budget, same as toolCalls) — origins
    // therefore lists attempted origins. Budgets stay global: one
    // 25-call cap, one run timeout.
    const perSession: Record<string, number> = {}
    const usedAliases: Array<string> = []
    const origins = (): Array<string> => {
      const seen = new Set<string>()
      const out: Array<string> = []
      for (const alias of usedAliases) {
        const origin = input.sessions[alias]?.origin ?? ""
        if (!seen.has(origin)) {
          seen.add(origin)
          out.push(origin)
        }
      }
      return out
    }
    // In-flight bridge fibers: joined for defect-loudness, interrupted
    // on finish so runaway page calls don't outlive the run. Defects
    // (bugs, not page failures) reject the join below and fail the run
    // with a dump-worthy message — never converted to a catchable reply.
    // (Post-settle defects are the one exception: finish is settled-
    // guarded, so a defect landing after settle is dropped, not
    // reported. The run already ended; nothing left to fail.)
    const fibers = new Set<Fiber.Fiber<void, never>>()
    // Host side runs raw JS inside Effect.callback (timers, worker
    // terminate, blob revoke) — the standard callback escape-hatch
    // shape, same precedent as the transport. Everything resumable goes
    // through `resume`; `finish` is settle-exactly-once. Timer is
    // declared first so no closer reads a later binding.
    const timer = setTimeout(() => {
      finish(Effect.fail({ message: `run timed out after ${input.timeoutMs}ms (worker killed).` }))
    }, input.timeoutMs)
    // Settle exactly once; every path terminates the worker AND revokes
    // the blob URL. Note the honest leak: killing the worker does not
    // recall page calls already dispatched — a consequential tool invoked
    // just before timeout may still land. Same as any client timeout;
    // reads are harmless, writes were already committed to by the code.
    // kill() is shared with the Effect.callback cleanup below so the
    // interrupt loop can't be forgotten on one path. Interrupts are
    // joined (not just forked): an interrupt defect would otherwise
    // reject unobserved, against the defect-loud posture below.
    const kill = (): void => {
      clearTimeout(timer)
      for (const fib of [...fibers]) {
        const stop = Effect.runFork(Fiber.interrupt(fib))
        Effect.runPromise(Fiber.join(stop)).then(() => {}, (defect) => {
          try {
            process.stderr.write(`agent-webmcp run: interrupt defect (dropped): ${String(defect)}\n`)
          } catch {}
        })
      }
      fibers.clear()
      try {
        worker.terminate()
      } catch {}
      try {
        if (blobUrl !== "") URL.revokeObjectURL(blobUrl)
      } catch {}
    }
    const finish = (eff: Effect.Effect<RunResult, { message: string }>): void => {
      if (settled) return
      settled = true
      kill()
      resume(eff)
    }
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { type: string; id?: number; op?: string; session?: unknown; tool?: string; args?: unknown; query?: string; name?: string; value?: unknown; message?: string }
      if (m.type === "done") {
        // Forged `done` bypasses the worker-side cap (it posts direct),
        // so gate host-side too: over-budget finals fail closed even on
        // the escape path. Strings measure free; objects pay
        // measure≈delivery; unmeasurable fails closed like everywhere
        // else (never passed through). Clone cost itself is accepted.
        const v = m.value ?? null
        let over = false
        let unmeasurable = false
        if (typeof v === "string") {
          over = v.length > input.maxDoneChars
        } else {
          try {
            const n = JSON.stringify(v)?.length ?? -1
            over = n >= 0 && n > input.maxDoneChars
            unmeasurable = n < 0
          } catch {
            unmeasurable = true
          }
        }
        if (unmeasurable) {
          finish(Effect.fail({ message: "result is not JSON-measurable (circular or BigInt?): simplify the return." }))
          return
        }
        if (over) {
          finish(Effect.fail({ message: `result exceeds final budget (${input.maxDoneChars} chars): chunk the read.` }))
          return
        }
        finish(Effect.succeed({ value: v, toolCalls: calls, perSession: { ...perSession }, origins: origins() }))
        return
      }
      if (m.type === "fail") {
        // Size-gate forged failures like forged finals: a 500M-char
        // message would OOM the host at clone before this branch.
        // (Forged fail ≡ throw — same nonce-rejection reasoning as
        // done ≡ return — but the SIZE gate still applies.)
        const text = String(m.message ?? "code failed")
        if (text.length > input.maxDoneChars) {
          finish(Effect.fail({ message: `failure message exceeds final budget (${input.maxDoneChars} chars): chunk the read.` }))
          return
        }
        finish(Effect.fail({ message: text }))
        return
      }
      // Non-bridge traffic (stray results for settled calls) is
      // dropped: pending ids are deleted on reply, so anything
      // unmatched has no waiter. Silent by design, not by omission.
      if (m.type !== "call" || m.id === undefined) return
      // Order is deliberate: malformed traffic is refused BEFORE the
      // call counter moves, so agent mistakes don't consume budget.
      // Snapshot-misses (unknown tool names) DO consume budget: the
      // miss is only known per alias snapshot, past the counter.
      // Fail-fast direction either way; typos cost one call each.
      // Only `invoke` counts toward the cap (search/describe are
      // bounded reads). Aliases are routing, not tools: unknown
      // aliases refuse pre-counter like malformed traffic.
      const reply = (ok: boolean, value: unknown, message: string): void => {
        try {
          worker.postMessage({ type: "result", id: m.id, ok, value, message })
        } catch {
          try {
            worker.postMessage({ type: "result", id: m.id, ok: false, value: null, message: "unpostable value" })
          } catch {}
        }
      }
      const runBridge = (eff: Effect.Effect<unknown, { message: string }>): void => {
        // Holder breaks the TDZ: a synchronous bridge effect can settle
        // during runFork, before `fib` is assigned. The join continuation
        // below is the prompt removal point (fires in a microtask even
        // for sync-settled fibers); `ensuring` is the backup for
        // interrupt paths. Either way no op leaks past its microtask —
        // a tight search/describe loop can't grow the set.
        const holder: { fib?: Fiber.Fiber<void, never> } = {}
        const task: Effect.Effect<void, never> = eff.pipe(
          Effect.match({
            onFailure: (e) => ({ kind: "fail" as const, message: e.message }),
            onSuccess: (value) => ({ kind: "ok" as const, value })
          }),
          // Result ceiling, every op (invoke/search/describe alike):
          // over-budget values become a catchable chunk-the-read error
          // instead of an unbounded structured-clone. Strings measure
          // free (the weaponizable shape); objects pay stringify-to-
          // measure, same order as the delivery it gates — the check
          // costs at most ~2x a delivery that was already budgeted.
          // Unmeasurable values (circular, BigInt) fail closed HERE
          // with a clear message — never passed through to die
          // ambiguously at the clone.
          Effect.flatMap((r) => {
            if (r.kind !== "ok") return Effect.sync(() => reply(false, null, r.message))
            let over = false
            let unmeasurable = false
            if (typeof r.value === "string") {
              over = r.value.length > input.maxResultChars
            } else {
              try {
                const n = JSON.stringify(r.value)?.length ?? -1
                over = n >= 0 && n > input.maxResultChars
                unmeasurable = n < 0
              } catch {
                unmeasurable = true
              }
            }
            return Effect.sync(() => {
              if (unmeasurable) {
                reply(false, null, "result is not JSON-measurable (circular or BigInt?): simplify the return.")
              } else if (over) {
                reply(false, null, `result exceeds per-call budget (${input.maxResultChars} chars): chunk the read.`)
              } else {
                reply(true, r.value, "")
              }
            })
          }),
          // Prompt removal point (double-delete with `ensuring` below is
          // intended): join fires in a microtask even for sync-settled
          // fibers, so a tight loop can't grow the set. `ensuring` stays
          // as the backup for interrupt paths.
          Effect.ensuring(Effect.sync(() => {
            if (holder.fib !== undefined) fibers.delete(holder.fib)
          }))
        )
        const fib: Fiber.Fiber<void, never> = Effect.runFork(task)
        holder.fib = fib
        fibers.add(fib)
        // Defects skip match entirely (typed failures only): the join
        // below rejects, and the run fails LOUD with the defect message.
        // Interrupts (our own timeout kill) reject too, but finish() is
        // settled-guarded so they no-op. Raw .then is the documented
        // escape hatch (same precedent as the callback body above):
        // the runtime can't own floating continuations, so the
        // settled-guard makes them safe instead.
        Effect.runPromise(Fiber.join(fib)).then(
          () => {
            fibers.delete(fib)
          },
          (defect) => {
            fibers.delete(fib)
            // Post-settle defects have no run left to fail: finish()
            // no-ops by guard. Bug-class failures must never vanish
            // silently, so say so on stderr (stdout is the MCP wire).
            const already = settled
            finish(Effect.fail({ message: "bridge defect (bug, not page failure): " + String(defect) }))
            if (already) {
              // Callback-hatch exemption (AGENTS.md:15-18): the runtime
              // can't own this floating continuation, stdout is the MCP
              // wire, so stderr-with-guard is the honest channel. Raw
              // write (not Console/Effect) is deliberate: post-settle
              // there is no fiber left to run an Effect on.
              try {
                process.stderr.write(`agent-webmcp run: post-settle bridge defect (dropped): ${String(defect)}\n`)
              } catch {}
            }
          }
        )
      }
      // Fail closed on malformed bridge traffic: non-object args would
      // otherwise become a default-args page action. Unknown ops
      // likewise — never coerce, always refuse. Settled guard first:
      // timeout/limit may have fired while messages were still queued.
      // finish() is idempotent, but dispatching NEW bridge work
      // post-settle would start consequential page calls after the run
      // ended (kill() can't recall them). Refuse instead — best-effort
      // reply (worker may be terminated; reply swallows that).
      if (settled) {
        reply(false, null, "run already settled (timeout/limit): call refused.")
        return
      }
      // Request gate (the forged-call path bypasses the worker-side
      // cap, so gate host-side too): refuse oversized/unmeasurable
      // requests before dispatch AND before the call counter moves.
      // Strings measure free; objects pay measure≈dispatch.
      const measure = (v: unknown): number | null => {
        try {
          if (typeof v === "string") return v.length
          const n = JSON.stringify(v)?.length ?? -1
          return n >= 0 ? n : null
        } catch {
          return null
        }
      }
      const gateRequest = (label: string, v: unknown): boolean => {
        const size = measure(v)
        if (size === null) {
          reply(false, null, `${label} is not JSON-measurable (circular or BigInt?): simplify the args.`)
          return false
        }
        if (size > input.maxResultChars) {
          reply(false, null, `${label} exceeds per-call budget (${input.maxResultChars} chars): chunk the args.`)
          return false
        }
        return true
      }
      if (m.op === "invoke") {
        if (typeof m.session !== "string" || !Object.hasOwn(input.sessions, m.session)) {
          reply(false, null, `bridge: unknown session '${String(m.session)}' (bound: ${aliases.join(", ")})`)
          return
        }
        const snapshot = input.sessions[m.session] as RunSessionSnapshot
        if (typeof m.tool !== "string") {
          reply(false, null, "bridge: invoke needs a string tool name")
          return
        }
        if (typeof m.args !== "object" || m.args === null || Array.isArray(m.args)) {
          reply(false, null, `bridge: args for '${m.tool}' must be a JSON object, got ${Array.isArray(m.args) ? "array" : typeof m.args}`)
          return
        }
        if (!gateRequest(`args for '${m.tool}'`, m.args)) return
        // Counter moves before the snapshot check: misses consume
        // budget (locked direction — typos cost one call each), and
        // the limit binds misses too.
        calls++
        perSession[m.session] = (perSession[m.session] ?? 0) + 1
        usedAliases.push(m.session)
        if (calls > input.maxToolCalls) {
          finish(Effect.fail({ message: `tool call limit exceeded (${input.maxToolCalls}): ending run.` }))
          return
        }
        if (!snapshot.tools.some((t) => t.name === m.tool)) {
          reply(false, null, `unknown tool '${m.tool}' on session '${m.session}'`)
          return
        }
        runBridge(input.dispatch(m.session, m.tool, m.args as Record<string, unknown>))
        return
      }
      if (m.op === "search" && typeof m.query === "string") {
        if (!gateRequest("search query", m.query)) return
        // Merged substring over every frozen snapshot, tagged per
        // session. Ranking lives in the `search` tool; in-code search
        // is intentionally the same documented limitation, ×N.
        const needle = m.query.toLowerCase()
        const hits: Array<{ name: string; description: string; session: string }> = []
        for (const alias of aliases) {
          const snapshot = input.sessions[alias] as RunSessionSnapshot
          for (const t of snapshot.tools) {
            if (t.name.toLowerCase().includes(needle)) {
              hits.push({ name: t.name, description: t.description, session: alias })
            }
          }
        }
        runBridge(Effect.succeed(hits))
        return
      }
      if (m.op === "describe" && typeof m.name === "string") {
        if (!gateRequest("describe name", m.name)) return
        if (typeof m.session === "string" && !Object.hasOwn(input.sessions, m.session)) {
          reply(false, null, `bridge: unknown session '${m.session}' (bound: ${aliases.join(", ")})`)
          return
        }
        const scopes = typeof m.session === "string" ? [m.session] : aliases
        const matches: Array<{ alias: string; tool: { name: string; description: string; inputSchema: unknown; annotations: unknown } }> = []
        for (const alias of scopes) {
          const snapshot = input.sessions[alias] as RunSessionSnapshot
          const found = snapshot.tools.find((t) => t.name === m.name)
          if (found !== undefined) matches.push({ alias, tool: found })
        }
        if (matches.length === 0) {
          reply(false, null, `unknown tool '${m.name}'`)
          return
        }
        if (matches.length > 1) {
          reply(false, null, `ambiguous tool '${m.name}': bound on ${matches.map((x) => x.alias).join(", ")} — pass the session`)
          return
        }
        const only = matches[0]
        runBridge(Effect.succeed({
          name: only.tool.name,
          description: only.tool.description,
          inputSchema: only.tool.inputSchema ?? {},
          annotations: only.tool.annotations,
          session: only.alias
        }))
        return
      }
      reply(false, null, `unknown bridge op: ${String(m.op)}`)
    }
    worker.onerror = (e: ErrorEvent) => {
      finish(Effect.fail({ message: `sandbox error: ${String((e as ErrorEvent).message || e)}` }))
    }
    try {
      worker.postMessage({ type: "start", code: input.code, sessions: aliases, defaultAlias: input.defaultAlias ?? null, maxResultChars: input.maxResultChars, maxDoneChars: input.maxDoneChars })
    } catch (cause) {
      finish(Effect.fail({ message: `cannot start run: ${String(cause)}` }))
    }
    return Effect.sync(() => {
      if (!settled) {
        settled = true
        kill()
      }
    })
  })
})
