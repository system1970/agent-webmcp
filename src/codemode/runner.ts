// Runner: agent JS in a Bun.Worker, host bridge over a queue. Budgets
// enforced with Effect operators only — timeout, Semaphore, Ref counters.
// No hand timers, no hand semaphores. Interruption terminates the worker
// through release; in-flight calls die with the scope that forked them.
import { Data, Deferred, Duration, Effect, Ref, Result, Semaphore } from "effect"
import { unlinkSync } from "node:fs"

export interface RunBudgets {
  readonly timeoutMs: number
  readonly maxToolCalls: number
  readonly maxChars: number
  readonly maxResultChars: number
}

export class CallFailed extends Data.TaggedError("CallFailed")<{
  readonly message: string
}> {}

export type CallFn = (input: unknown) => Effect.Effect<unknown, CallFailed>

export interface RunOk {
  readonly ok: true
  readonly value: unknown
  readonly spilled: boolean
  readonly toolCalls: number
  readonly calls: ReadonlyArray<string>
}

export interface RunDiagnostic {
  readonly kind: "ParseError" | "TimeoutExceeded" | "ToolCallLimitExceeded" | "ToolFailure"
  readonly message: string
}

export interface RunFail {
  readonly ok: false
  readonly error: RunDiagnostic
  readonly toolCalls: number
  readonly calls: ReadonlyArray<string>
}

export type RunResult = RunOk | RunFail

type WorkerMsg =
  | { readonly type: "call"; readonly id: number; readonly path: string; readonly input: unknown }
  | { readonly type: "done"; readonly value: unknown }
  | { readonly type: "fail"; readonly kind: RunDiagnostic["kind"]; readonly message: string }

type HostMsg = { readonly type: "result"; readonly id: number; readonly ok: boolean; readonly value?: unknown; readonly message?: string }

// Worker source: `tools` is a proxy tree — every property access builds
// a deeper path, every call posts it to the host. Unknown paths reach
// the host too (reply: unknown tool path) instead of dying as TypeErrors
// in-page. `then`/symbols resolve undefined so `await` never traps.
const workerSource = (code: string): string => `
const __pending = new Map();
let __seq = 0;
const __call = (path, input) => new Promise((resolve, reject) => {
  const id = __seq++;
  __pending.set(id, { resolve, reject });
  postMessage({ type: "call", id, path, input });
});
const __at = (path) => new Proxy(function () {}, {
  get: (_, prop) => {
    if (typeof prop === "symbol" || prop === "then") return undefined;
    const p = path === "" ? String(prop) : path + "." + String(prop);
    return __at(p);
  },
  apply: (_, __, a) => __call(path, a.length > 0 ? a[0] : null),
});
const tools = __at("");
onmessage = (e) => {
  const m = e.data;
  if (m && m.type === "result") {
    const p = __pending.get(m.id);
    __pending.delete(m.id);
    if (p) { m.ok ? p.resolve(m.value) : p.reject(new Error(m.message)); }
  }
};
function __normalize(v, depth) {
  if (depth > 32) return "[truncated: depth]";
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === "function") return "[function]";
  if (typeof v === "bigint") return String(v);
  if (typeof v === "symbol") return String(v);
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => __normalize(x, depth + 1));
  const o = {};
  for (const k of Object.keys(v).slice(0, 1000)) o[k] = __normalize(v[k], depth + 1);
  return o;
}
(async () => {
  let fn;
  try {
    fn = new Function("tools", '"use strict"; return (async () => {\\n' + ${JSON.stringify(code)} + '\\n})()');
  } catch (err) {
    postMessage({ type: "fail", kind: "ParseError", message: String(err && err.message || err).slice(0, 500) });
    return;
  }
  try {
    const value = await fn(tools);
    postMessage({ type: "done", value: __normalize(value, 0) });
  } catch (err) {
    postMessage({ type: "fail", kind: "ToolFailure", message: String(err && err.message || err).slice(0, 500) });
  }
})();
`

export const runCode = Effect.fn("runner.runCode")(function* (options: {
  code: string
  calls: Record<string, CallFn>
  budgets: RunBudgets
}) {
  const { code, calls, budgets } = options
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const sem = yield* Semaphore.make(8)
      const counts = yield* Ref.make({ calls: 0, spilled: false, paths: [] as Array<string> })
      const gate = yield* Deferred.make<RunResult>()
    const path = `${process.env.TMPDIR ?? "/tmp"}/agent-webmcp-run-${crypto.randomUUID()}.mjs`
    const spawned = yield* Effect.tryPromise({
      try: async () => {
        await Bun.write(path, workerSource(code))
        return new Worker(path)
      },
      catch: (err) => err,
    }).pipe(Effect.result)
    if (!Result.isSuccess(spawned)) {
      return {
        ok: false as const,
        error: { kind: "ToolFailure" as const, message: "worker spawn failed (disk or runtime)" },
        toolCalls: 0,
        calls: [],
      }
    }
    const worker = yield* Effect.acquireRelease(Effect.succeed(spawned.success), (w) =>
      Effect.sync(() => {
        try {
          w.terminate()
        } catch {
          // Terminate is best-effort; the scope already ends the run.
        }
        try {
          unlinkSync(path)
        } catch {
          // Temp files die with /tmp anyway.
        }
      })
    )
    // tell: postMessage throws once the worker is gone; every reply
    // site goes through here so a dead worker is silence, not a defect.
    const tell = (msg: HostMsg): void => {
      try {
        worker.postMessage(msg)
      } catch {
        // The run ended under us — nothing left to answer.
      }
    }
    worker.onmessage = (event) => {
      const msg = event.data as WorkerMsg
      if (msg.type === "done" || msg.type === "fail") {
        Deferred.doneUnsafe(
          gate,
          Effect.gen(function* () {
            const c = yield* Ref.get(counts)
            if (msg.type === "done") {
              const text = JSON.stringify(msg.value) ?? "null"
              if (text.length > budgets.maxResultChars) {
                yield* Ref.update(counts, (s) => ({ ...s, spilled: true }))
                return { ok: true as const, value: `${text.slice(0, budgets.maxResultChars)}…[truncated]`, spilled: true, toolCalls: c.calls, calls: c.paths }
              }
              return { ok: true as const, value: msg.value === undefined ? null : msg.value, spilled: c.spilled, toolCalls: c.calls, calls: c.paths }
            }
            return { ok: false as const, error: { kind: msg.kind, message: msg.message }, toolCalls: c.calls, calls: c.paths }
          })
        )
        return
      }
      // A call: admit (count + size gate), run bounded, reply.
      const call = calls[msg.path]
      if (call === undefined) {
        tell({ type: "result", id: msg.id, ok: false, message: `unknown tool path: ${msg.path}` })
        return
      }
      const inputText = JSON.stringify(msg.input) ?? "null"
      if (inputText.length > budgets.maxChars) {
        tell({ type: "result", id: msg.id, ok: false, message: `input exceeds maxChars (${inputText.length} > ${budgets.maxChars})` })
        return
      }
      Effect.runFork(
        Effect.forkIn(scope)(
          Semaphore.withPermits(sem, 1)(
            Effect.gen(function* () {
              const n = yield* Ref.modify(counts, (s): readonly [boolean, { calls: number; spilled: boolean; paths: Array<string> }] =>
                s.calls >= budgets.maxToolCalls
                  ? [false, s]
                  : [true, { calls: s.calls + 1, spilled: s.spilled, paths: [...s.paths, msg.path] }]
              )
              if (!n) {
                const c = yield* Ref.get(counts)
                Deferred.doneUnsafe(
                  gate,
                  Effect.succeed({
                    ok: false as const,
                    error: { kind: "ToolCallLimitExceeded" as const, message: `past maxToolCalls (${budgets.maxToolCalls})` },
                    toolCalls: c.calls,
                    calls: c.paths,
                  })
                )
                tell({ type: "result", id: msg.id, ok: false, message: `past maxToolCalls (${budgets.maxToolCalls})` })
                return
              }
              const out = yield* call(msg.input).pipe(
                Effect.mapError((err) => err.message),
                Effect.result
              )
              if (!Result.isSuccess(out)) {
                tell({ type: "result", id: msg.id, ok: false, message: out.failure.slice(0, 500) })
                return
              }
              const outText = JSON.stringify(out.success) ?? "null"
              if (outText.length > budgets.maxChars) {
                yield* Ref.update(counts, (s) => ({ ...s, spilled: true }))
              }
              tell({ type: "result", id: msg.id, ok: true, value: out.success })
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => tell({ type: "result", id: msg.id, ok: false, message: `host defect: ${String(cause).slice(0, 200)}` }))
              )
            )
          )
        )
      )
    }
    // The run ends at the gate (worker done/fail) or the timeout below.
    // Timeout is a diagnostic, never a defect. Scope close terminates
    // the worker and interrupts forked calls.
    return yield* Deferred.await(gate).pipe(
      Effect.timeout(Duration.millis(budgets.timeoutMs)),
      Effect.catchTag("TimeoutError", () =>
        Ref.get(counts).pipe(
          Effect.map((c) => ({ ok: false as const, error: { kind: "TimeoutExceeded" as const, message: `past timeoutMs (${budgets.timeoutMs})` }, toolCalls: c.calls, calls: c.paths }))
        )
      )
    )
  }))
})
