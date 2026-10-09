import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CHAR_BUDGET, RUN_MAX_DONE_CHARS, RUN_MAX_TOOL_CALLS, RUN_TIMEOUT_DEFAULT_MS } from "../budgets.ts"
import { DENIED_GLOBALS, runCode } from "./runner.ts"
import type { RunBridge } from "./runner.ts"

// Stub bridge: pure in-memory tools, no browser. Proves the runner's
// mechanics (loops, branches, errors, isolation, limits) deterministically.
const stubBridge = (calls: Array<string>): RunBridge => ({
  invoke: (tool, args) => {
    calls.push(tool)
    if (tool === "boom") return Effect.fail({ message: "boom failed" })
    if (tool === "echo") return Effect.succeed({ got: (args as { x?: unknown }).x ?? null })
    if (tool === "big") return Effect.succeed({ blob: "z".repeat(100) })
    return Effect.fail({ message: `unknown tool '${tool}'` })
  },
  search: (query) => Effect.succeed([{ name: "echo", description: `matches ${query}` }]),
  describe: (name) => name === "echo"
    ? Effect.succeed({ name, inputSchema: {} })
    : Effect.fail({ message: `unknown tool '${name}'` })
})

const run = (code: string, opts?: { timeoutMs?: number; maxToolCalls?: number; maxResultChars?: number; maxDoneChars?: number }): Promise<{ value: unknown; toolCalls: number }> => {
  const calls: Array<string> = []
  return Effect.runPromise(runCode({
    code,
    bridge: stubBridge(calls),
    timeoutMs: opts?.timeoutMs ?? RUN_TIMEOUT_DEFAULT_MS,
    maxToolCalls: opts?.maxToolCalls ?? RUN_MAX_TOOL_CALLS,
    maxResultChars: opts?.maxResultChars ?? CHAR_BUDGET.max,
    maxDoneChars: opts?.maxDoneChars ?? RUN_MAX_DONE_CHARS
  }).pipe(Effect.map((r) => ({ value: r.value, toolCalls: r.toolCalls }))))
}

const runErr = (code: string, opts?: { timeoutMs?: number; maxToolCalls?: number; maxResultChars?: number; maxDoneChars?: number }): Promise<string> =>
  Effect.runPromise(runCode({
    code,
    bridge: stubBridge([]),
    timeoutMs: opts?.timeoutMs ?? RUN_TIMEOUT_DEFAULT_MS,
    maxToolCalls: opts?.maxToolCalls ?? RUN_MAX_TOOL_CALLS,
    maxResultChars: opts?.maxResultChars ?? CHAR_BUDGET.max,
    maxDoneChars: opts?.maxDoneChars ?? RUN_MAX_DONE_CHARS
  }).pipe(
    Effect.map(() => "unexpected success"),
    Effect.catch((e) => Effect.succeed(String((e as { message?: unknown }).message ?? e)))
  ))

describe("runner", () => {
  test("loops, branches, and filters in code", async () => {
    const out = await run(`
      const seen = [];
      for (const x of [1, 2, 3]) {
        const r = await tools.echo({ x });
        if (r.got > 1) seen.push(r.got);
      }
      return { seen, n: seen.length };
    `)
    expect(out.value).toEqual({ seen: [2, 3], n: 2 })
    expect(out.toolCalls).toBe(3)
  })

  test("search and describe globals work", async () => {
    const out = await run(`return (await search("ec")).map((t) => t.name);`)
    expect(out.value).toEqual(["echo"])
  })

  test("tool failure throws catchable Error", async () => {
    const out = await run(`
      try { await tools.boom({}); return "no-throw"; }
      catch (e) { return "caught:" + e.message; }
    `)
    expect(out.value).toBe("caught:boom failed")
  })

  test("uncaught failure fails the run", async () => {
    expect(await runErr(`await tools.boom({}); return 1;`)).toMatch(/boom failed/)
  })

  test("unknown tool fails fast", async () => {
    expect(await runErr(`return await tools.nope({});`)).toMatch(/unknown tool/)
  })

  test("empty code fails", async () => {
    expect(await runErr("   ")).toMatch(/empty/)
  })

  test("tool call limit ends the run", async () => {
    expect(await runErr(`while (true) { await tools.echo({}); }`, { maxToolCalls: 3 })).toMatch(/limit exceeded/)
  })

  test("infinite loop dies on timeout", async () => {
    expect(await runErr(`while (true) {}`, { timeoutMs: 300 })).toMatch(/timed out/)
  })

  test("denied globals are undefined (timers, net, host)", async () => {
    const out = await run(`return [typeof Function, typeof setTimeout, typeof fetch, typeof process, typeof Bun, typeof require, typeof Worker];`)
    expect(out.value).toEqual(["undefined", "undefined", "undefined", "undefined", "undefined", "undefined", "undefined"])
  })

  test("forged completion shadowed for cooperating code", async () => {
    const out = await run(`return [typeof postMessage, typeof onmessage, typeof self, typeof globalThis];`)
    expect(out.value).toEqual(["undefined", "undefined", "undefined", "undefined"])
  })

  test("realm aliases audited (global/navigator/window/importScripts)", async () => {
    // Cooperating-code view: all undefined (shadowed or absent).
    // Probed realm truth: `global` and `navigator` EXIST (Bun/Node
    // aliases — `global` was a live backdoor to fetch/process before
    // shadowing), `window`/`importScripts` don't. If the platform adds
    // one, this turns red instead of silently opening a backdoor.
    const out = await run(`return [typeof global, typeof navigator, typeof window, typeof importScripts];`)
    expect(out.value).toEqual(["undefined", "undefined", "undefined", "undefined"])
  })

  test("every denied name is actually shadowed (single-source lock)", async () => {
    expect(new Set(DENIED_GLOBALS).size).toBe(DENIED_GLOBALS.length)
    const out = await run(`return [${DENIED_GLOBALS.map((n) => `typeof ${n}`).join(", ")}];`)
    expect(out.value).toEqual(DENIED_GLOBALS.map(() => "undefined"))
  })

  test("strict-mode agent code compiles (eval shadow is outer-sloppy)", async () => {
    // The wrapper puts user code inside an inner arrow, so a "use
    // strict" prologue strictens the arrow — not the outer Function
    // whose params include `eval` (a StrictFormalParameters error if
    // it were strict). Locked: valid JS must not fail to compile.
    const out = await run(`"use strict"; return 1 + 1;`)
    expect(out.value).toBe(2)
  })

  test("KNOWN LIMITATION: constructor escape reaches the worker realm", async () => {
    // Accident containment, not a boundary: ({}).constructor recovers
    // the realm's real globals. Locked here so the claim can't
    // silently drift — docs say containment, never isolation.
    const out = await run(`return ({}).constructor.constructor("return typeof fetch")();`)
    expect(out.value).toBe("function")
    // One-step spelling is DEAD for bridged callables: tools/search/
    // describe are masked proxies whose .constructor/.prototype/
    // .__proto__/.valueOf read undefined and whose prototype chain is
    // nulled — every verified sub-path (probed live) ends here. (The
    // ({}).constructor long spelling survives by design — Proxy can't
    // intercept Object literals.)
    const masked = await run(`return [typeof tools.echo.__proto__, typeof search.__proto__, typeof search.valueOf, typeof tools.__proto__];`)
    expect(masked.value).toEqual(["undefined", "undefined", "undefined", "undefined"])
    const nulled = await run(`
      const out = [];
      try { Object.getPrototypeOf(search).constructor; out.push("leaked"); }
      catch (e) { out.push("blocked"); }
      try { tools.echo.constructor("return 1")(); out.push("leaked"); }
      catch (e) { out.push("blocked"); }
      return out;
    `)
    expect(nulled.value).toEqual(["blocked", "blocked"])
  })

  test("post-settle calls are refused, never dispatched (delivery-agnostic)", async () => {
    // Forged done settles the run; a forged call right behind it must
    // NOT dispatch new bridge work (pre-guard it would invoke echo —
    // a fresh consequential page call after the run ended). Whether
    // Bun delivers the second message post-terminate or drops it, the
    // stub sees zero invokes either way: this locks refusal-or-drop,
    // not refusal alone — named honestly so nobody misreads coverage.
    const calls: Array<string> = []
    const out = await Effect.runPromise(runCode({
      code: `
        const livePost = ({}).constructor.constructor("return postMessage")();
        livePost({ type: "done", value: "forged-end" });
        livePost({ type: "call", id: 77, op: "invoke", tool: "echo", args: {} });
        return "never";
      `,
      bridge: stubBridge(calls),
      timeoutMs: RUN_TIMEOUT_DEFAULT_MS,
      maxToolCalls: RUN_MAX_TOOL_CALLS,
      maxResultChars: CHAR_BUDGET.max,
      maxDoneChars: RUN_MAX_DONE_CHARS
    }))
    expect(out.value).toBe("forged-end")
    expect(calls).toEqual([])
  })

  test("KNOWN LIMITATION: forged completion ends the run", async () => {
    // Via the constructor escape, code recovers the live postMessage
    // and a `done` is a return by another name: the first message wins
    // (FIFO), so the forged value lands and the real return is dropped
    // by the settled guard. Caps bind cooperating code only — locked.
    const out = await run(`
      const livePost = ({}).constructor.constructor("return postMessage")();
      livePost({ type: "done", value: "pwned" });
      return "should-never-arrive";
    `)
    expect(out.value).toBe("pwned")
  })

  test("KNOWN LIMITATION: spawn primitives are importable in the worker", async () => {
    // Hermetic version of the survival probe: importing
    // node:child_process (the spawn vector) needs no OS process.
    // Survival past worker.terminate() was probed live manually
    // (detached sleep alive after kill, signal-0 verified) — the
    // standing invitation to re-probe is in docs/run-accepted-risk.md.
    const out = await run(`const cp = await import("node:child_process"); return [typeof cp.spawn, typeof cp.exec];`)
    expect(out.value).toEqual(["function", "function"])
  })

  test("KNOWN LIMITATION: dynamic import() reaches live modules", async () => {
    // Same privilege class as the constructor escape (probed live:
    // node:fs imports, readFileSync is a function). `import` is a
    // keyword — unshadowable by the param trick. Locked so the header
    // disclaimer can't drift from the mechanism.
    const out = await run(`const fs = await import("node:fs"); return typeof fs.readFileSync;`)
    expect(out.value).toBe("function")
  })

  test("oversized bridge results fail catchable (every op)", async () => {
    const big = await run(`return "x".repeat(100);`, { maxResultChars: 10 })
    expect(big.value).toBe("x".repeat(100))
    // Oversized ARGS fail at the WORKER-side request gate (proved by
    // the message text: the host gate says "args for 'echo'", the
    // worker gate says "request exceeds" — this asserts the worker's,
    // which fires first because the message is never posted).
    const reqOver = await run(`
      try { await tools.echo({ x: "y".repeat(100) }); return "no-throw"; }
      catch (e) { return "caught:" + e.message; }
    `, { maxResultChars: 10 })
    expect(reqOver.value).toMatch(/caught:.*request exceeds per-call budget/)
    // Forged giant CALL (escape path, bypasses the worker gate) is
    // refused by the HOST gate: no dispatch, no budget consumed, the
    // forged reply id (999) matches no waiter and drops silently.
    const forged = await Effect.runPromise(runCode({
      code: `
        const livePost = ({}).constructor.constructor("return postMessage")();
        livePost({ type: "call", id: 999, op: "invoke", tool: "echo", args: { x: "y".repeat(100) } });
        return "survived";
      `,
      bridge: stubBridge([]),
      timeoutMs: RUN_TIMEOUT_DEFAULT_MS,
      maxToolCalls: RUN_MAX_TOOL_CALLS,
      maxResultChars: 10,
      maxDoneChars: RUN_MAX_DONE_CHARS
    }))
    expect(forged.value).toBe("survived")
    expect(forged.toolCalls).toBe(0)
    // ...while oversized RESULTS fail at the result gate. tools.big
    // takes tiny args and returns a large value: request passes,
    // result refuses. (Cap 50 sits between the 24-char request
    // envelope and the ~112-char result — cap 10 would refuse both.)
    const resOver = await run(`
      try { await tools.big({}); return "no-throw"; }
      catch (e) { return "caught:" + e.message; }
    `, { maxResultChars: 50 })
    expect(resOver.value).toMatch(/caught:.*result exceeds/)
    // search/describe ride the same ceiling: tiny caps fail them too.
    const searchOver = await run(`
      try { await search("ec"); return "no-throw"; }
      catch (e) { return "caught:" + e.message; }
    `, { maxResultChars: 5 })
    expect(searchOver.value).toMatch(/caught:.*per-call budget/)
    const describeOver = await run(`
      try { await describe("echo"); return "no-throw"; }
      catch (e) { return "caught:" + e.message; }
    `, { maxResultChars: 5 })
    expect(describeOver.value).toMatch(/caught:.*per-call budget/)
  })

  test("runner rejects oversized code itself", async () => {
    expect(await runErr(`return 1; /*${"x".repeat(70000)}*/`)).toMatch(/chunk the block/)
  })

  test("final done value capped worker-side pre-clone", async () => {
    // Zero bridge calls, arbitrarily large synthesis: without the
    // worker-side cap the host would clone + stringify before spill.
    expect(await runErr(`return "x".repeat(100);`, { maxDoneChars: 10 })).toMatch(/final budget/)
    const under = await run(`return "x".repeat(100);`, { maxDoneChars: 1000 })
    expect(under.value).toBe("x".repeat(100))
  })

  test("compile errors report cleanly", async () => {
    expect(await runErr(`const = = =`)).toMatch(/compile/)
  })
})
