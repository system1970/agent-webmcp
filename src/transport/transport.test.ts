import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { TransportFailed, webmcpFloorFix, WEBMCP_LAUNCH_FLAGS } from "./errors.ts"
import { mergeToolEvent, normalizeAnnotations, waitForEvent, evaluatePage } from "./client.ts"
import type { CdpListener, Connection, PageTool } from "./client.ts"

const tool = (name: string, frameId = "F1"): PageTool => ({
  name,
  description: `${name} does things`,
  inputSchema: { type: "object" },
  annotations: { readOnly: true },
  frameId
})

describe("errors", () => {
  test("TransportFailed carries reason, operation, message, fix", () => {
    const e = new TransportFailed({
      reason: "no-browser",
      operation: "dial",
      message: "nothing listens",
      fix: "launch it"
    })
    expect(e._tag).toBe("TransportFailed")
    expect(e.reason).toBe("no-browser")
    expect(e.fix).toBe("launch it")
  })

  test("webmcpFloorFix names the version floor, not flags", () => {
    expect(webmcpFloorFix).toContain("152")
    expect(webmcpFloorFix).not.toContain("--enable-features")
  })

  test("launched browsers carry the Testing flag (localhost needs it)", () => {
    expect(WEBMCP_LAUNCH_FLAGS).toContain("WebMCPTesting")
  })

  test("TransportFailed flows through the Effect error channel", async () => {
    const failure = await Effect.runPromise(
      Effect.fail(new TransportFailed({
        reason: "timeout",
        operation: "op",
        message: "slow"
      })).pipe(
        Effect.catchTag("TransportFailed", (e) => Effect.succeed(e.reason))
      )
    )
    expect(failure).toBe("timeout")
  })

  test("function-form tryPromise fails (never dies) on rejection", async () => {
    // Load-bearing for every fetch/poll in launch + evals: if v4
    // function-form defected instead of failing, the catch below would
    // miss it and runPromise would reject. Pinned against the vendored pin.
    const result = await Effect.runPromise(
      Effect.tryPromise(() => Promise.reject(new Error("boom"))).pipe(
        Effect.catch(() => Effect.succeed("caught"))
      )
    )
    expect(result).toBe("caught")
  })
})

describe("mergeToolEvent", () => {
  const catalogOf = (result: { catalog: Map<string, PageTool> }): Map<string, PageTool> => result.catalog

  test("toolsAdded inserts keyed by frame+name", () => {
    const next = catalogOf(mergeToolEvent(new Map(), "WebMCP.toolsAdded", { tools: [tool("a"), tool("b")] }))
    expect([...next.keys()].sort()).toEqual(["F1::a", "F1::b"])
  })

  test("same name in two frames is two tools", () => {
    let catalog = catalogOf(mergeToolEvent(new Map(), "WebMCP.toolsAdded", { tools: [tool("a", "F1")] }))
    catalog = catalogOf(mergeToolEvent(catalog, "WebMCP.toolsAdded", { tools: [tool("a", "F2")] }))
    expect(catalog.size).toBe(2)
  })

  test("toolsRemoved deletes only the named frame entry", () => {
    let catalog = catalogOf(mergeToolEvent(new Map(), "WebMCP.toolsAdded", {
      tools: [tool("a", "F1"), tool("a", "F2")]
    }))
    catalog = catalogOf(mergeToolEvent(catalog, "WebMCP.toolsRemoved", {
      tools: [{ name: "a", frameId: "F1" }]
    }))
    expect([...catalog.keys()]).toEqual(["F2::a"])
  })

  test("re-added tool replaces the entry", () => {
    let catalog = catalogOf(mergeToolEvent(new Map(), "WebMCP.toolsAdded", { tools: [tool("a")] }))
    const changed: PageTool = { ...tool("a"), description: "new words" }
    catalog = catalogOf(mergeToolEvent(catalog, "WebMCP.toolsAdded", { tools: [changed] }))
    expect(catalog.size).toBe(1)
    expect(catalog.get("F1::a")?.description).toBe("new words")
  })

  test("unknown events and malformed params leave the catalog alone", () => {
    const before = catalogOf(mergeToolEvent(new Map(), "WebMCP.toolsAdded", { tools: [tool("a")] }))
    expect(catalogOf(mergeToolEvent(before, "Page.loadEventFired", {})).size).toBe(1)
    expect(catalogOf(mergeToolEvent(before, "WebMCP.toolsAdded", null)).size).toBe(1)
    expect(catalogOf(mergeToolEvent(before, "WebMCP.toolsAdded", {})).size).toBe(1)
  })

  test("entries missing name or frameId are quarantined and counted", () => {
    const result = mergeToolEvent(new Map(), "WebMCP.toolsAdded", {
      tools: [{ description: "nameless" }, tool("fine")]
    })
    expect([...result.catalog.keys()]).toEqual(["F1::fine"])
    expect(result.quarantined).toBe(1)
  })

  test("foreign annotation keys pass through decode (future-tolerant)", () => {
    const result = mergeToolEvent(new Map(), "WebMCP.toolsAdded", {
      tools: [{ ...tool("a"), annotations: { readOnly: true, consequentialHint: true } }]
    })
    expect(result.catalog.size).toBe(1)
    expect(result.quarantined).toBe(0)
  })

  test("spec Hint spellings normalize to base names (live :8901 shape)", () => {
    expect(normalizeAnnotations({ readOnlyHint: true })).toEqual({ readOnly: true })
    expect(normalizeAnnotations({ untrustedContentHint: true })).toEqual({ untrustedContent: true })
    expect(normalizeAnnotations({})).toEqual({})
  })

  test("base names win over Hint on conflict", () => {
    expect(normalizeAnnotations({ readOnly: false, readOnlyHint: true })).toEqual({ readOnly: false })
  })

  test("merge path maps Hint annotations (getStock arrives readOnly)", () => {
    const result = mergeToolEvent(new Map(), "WebMCP.toolsAdded", {
      tools: [{ ...tool("getStock"), annotations: { readOnlyHint: true } }]
    })
    expect(result.catalog.get("F1::getStock")?.annotations).toEqual({ readOnly: true })
    expect(result.quarantined).toBe(0)
  })

  test("wrong-typed Hint values quarantine the item, never siblings", () => {
    const result = mergeToolEvent(new Map(), "WebMCP.toolsAdded", {
      tools: [{ ...tool("bad"), annotations: { readOnlyHint: "yes" } }, tool("fine")]
    })
    expect([...result.catalog.keys()]).toEqual(["F1::fine"])
    expect(result.quarantined).toBe(1)
  })
})

// A connection with no browser behind it: calls fail, events only fire when
// the test fires them. Proves the wait/timeout/filter logic without a page.
const stubConn = (): { conn: Connection; emit: (method: string, params: unknown, sessionId?: string) => void } => {
  const listeners = new Set<CdpListener>()
  const conn: Connection = {
    endpoint: "stub",
    call: () => Effect.fail(new TransportFailed({ reason: "protocol", operation: "stub", message: "no browser" })),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close: Effect.void
  }
  return {
    conn,
    emit: (method, params, sessionId) => {
      for (const l of listeners) l(method, params, sessionId)
    }
  }
}

describe("evaluatePage", () => {
  // Programmed Runtime.evaluate replies: values pass through untouched
  // (an `{error:...}` OBJECT is data, never a failure signal), throws
  // surface as errorText, malformed replies fail protocol. L6 lock for
  // the inject result shape — every field consumed here, no browser.
  const replyConn = (reply: unknown): Connection => ({
    ...stubConn().conn,
    call: () => Effect.succeed(reply)
  })
  const run = <A>(e: Effect.Effect<A, TransportFailed>): Promise<A> => Effect.runPromise(e)

  test("value passes through, error-keyed objects included", async () => {
    expect(await run(evaluatePage(replyConn({ result: { value: { error: "none" } } }), "S", "1")))
      .toEqual({ ok: true, value: { error: "none" } })
    expect(await run(evaluatePage(replyConn({ result: { value: 42 } }), "S", "1")))
      .toEqual({ ok: true, value: 42 })
  })

  test("thrown expression surfaces errorText, never silent success", async () => {
    expect(await run(evaluatePage(
      replyConn({ exceptionDetails: { text: "Uncaught", exception: { description: "TypeError: x\n    at y" } } }),
      "S", "1"
    ))).toEqual({ ok: false, errorText: "Uncaught: TypeError: x" })
  })

  test("empty-object reply decodes to undefined value; garbage fails protocol", async () => {
    expect(await run(evaluatePage(replyConn({ nope: 1 }), "S", "1")))
      .toEqual({ ok: true, value: undefined })
    const failure = await Effect.runPromise(evaluatePage(replyConn(42), "S", "1").pipe(Effect.flip))
    expect(failure).toBeInstanceOf(TransportFailed)
    expect((failure as TransportFailed).reason).toBe("protocol")
  })
})

describe("waitForEvent", () => {
  test("no matching event fails timeout with the operation named", async () => {
    const { conn } = stubConn()
    const failure = await Effect.runPromise(
      waitForEvent(conn, () => false, 50, "stub-wait").pipe(Effect.flip)
    )
    expect(failure).toBeInstanceOf(TransportFailed)
    expect((failure as TransportFailed).reason).toBe("timeout")
    expect((failure as TransportFailed).fix).toBeDefined()
  })

  test("matching event resolves, other sessions ignored", async () => {
    const { conn, emit } = stubConn()
    const waited = Effect.runPromise(
      waitForEvent(conn, (m) => m === "X.fired", 1000, "stub-wait", "S1")
    )
    emit("X.fired", { n: 1 }, "S2")
    emit("X.fired", { n: 2 }, "S1")
    expect(await waited).toEqual({ n: 2 })
  })
})
