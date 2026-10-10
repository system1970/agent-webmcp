// Registry tests: resolution, round-trip, guards. Pure + tmp-dir only,
// no browser, no network.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  listOriginTools,
  loadTool,
  resolveProjectRoot,
  resolveRoot,
  saveTool,
  slugOf,
  userGlobalRoot,
  REGISTRY_ENV,
} from "./registry.ts"

const fails = <A, E>(effect: Effect.Effect<A, E, never>): Promise<E> => Effect.runPromise(Effect.flip(effect))

describe("registry", () => {
  test("resolution order: flag-override > env > walk-up > undefined", () => {
    const exists = (d: string): boolean => d === "/proj/.agent-webmcp"
    expect(resolveProjectRoot("/proj/sub", "/env-root", exists)).toBe("/env-root")
    expect(resolveProjectRoot("/proj/sub", undefined, exists)).toBe("/proj/.agent-webmcp/registry")
    expect(resolveProjectRoot("/nowhere/deep", undefined, () => false)).toBeUndefined()
    expect(resolveProjectRoot("/proj/sub", "", exists)).toBe("/proj/.agent-webmcp/registry")
  })

  test("startup override wins over everything (per-call proxy harnesses)", async () => {
    const { setRegistryRoot, clearRegistryRoot, registryOverrideRoot } = await import("./registry.ts")
    expect(registryOverrideRoot()).toBeUndefined()
    setRegistryRoot("/fixed/root")
    try {
      const exists = (): boolean => false
      expect(resolveProjectRoot("/nowhere", "/env-root", exists)).toBe("/fixed/root")
      expect(resolveRoot("/nowhere", undefined, exists, "linux")).toBe("/fixed/root")
    } finally {
      clearRegistryRoot()
    }
    expect(registryOverrideRoot()).toBeUndefined()
  })

  test("always resolves: global home is the default", () => {
    const exists = (): boolean => false
    expect(resolveRoot("/nowhere/deep", undefined, exists, "linux")).toBe(userGlobalRoot("linux"))
    expect(resolveRoot("/proj", "", exists, "linux")).toBe(userGlobalRoot("linux"))
  })

  test("user-global fallback differs per OS (pure)", () => {
    expect(userGlobalRoot("linux")).toContain(".local/share/agent-webmcp/registry")
    expect(userGlobalRoot("darwin")).toContain("Library/Application Support/agent-webmcp/registry")
    expect(userGlobalRoot("win32")).toContain("agent-webmcp/registry")
  })

  test("slug matrix", () => {
    expect(slugOf("https://Example.COM:443/x")).toBe("example-com")
    expect(slugOf("https://app.example.com/")).toBe("app-example-com")
    expect(slugOf("not a url at all")).toBe("not-a-url-at-all")
  })

  test("round-trip byte-identical", async () => {
    const root = mkdtempSync(join(tmpdir(), "reg-test-"))
    try {
      const spec = {
        name: "ping",
        description: "Ping",
        inputSchema: { type: "object", properties: {} },
        version: 1 as const,
        createdAt: 0,
      }
      await Effect.runPromise(saveTool(root, "https://x.test", "ping", spec, "(async () => 1)"))
      const loaded = await Effect.runPromise(loadTool(root, "https://x.test", "ping"))
      expect(loaded.body).toBe("(async () => 1)")
      expect(loaded.spec.name).toBe("ping")
      expect(await Effect.runPromise(listOriginTools(root, "https://x.test"))).toEqual(["ping"])
      expect(await Effect.runPromise(listOriginTools(root, "https://y.test"))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("origin.txt mismatch fails loud (slug collision guard)", async () => {
    const root = mkdtempSync(join(tmpdir(), "reg-test-"))
    try {
      const spec = { name: "a", description: "d", inputSchema: {}, version: 1 as const, createdAt: 0 }
      await Effect.runPromise(saveTool(root, "https://a-b.test", "a", spec, "1"))
      const err = await fails(saveTool(root, "https://a_b.test", "b", spec, "1"))
      // Both slug to a-b-test; the guard must catch the second origin.
      // (Underscores are invalid hostnames in practice; either outcome is
      //  acceptable as long as origins never mix silently.)
      void err
      const listed = await Effect.runPromise(listOriginTools(root, "https://a-b.test"))
      expect(listed).toContain("a")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("missing tool fails with fix", async () => {
    const root = mkdtempSync(join(tmpdir(), "reg-test-"))
    try {
      const err = await fails(loadTool(root, "https://x.test", "nope"))
      expect(err.reason).toBe("missing")
      expect(err.fix.length).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("symlink escape refused (parent component)", async () => {
    const root = mkdtempSync(join(tmpdir(), "reg-test-"))
    const outside = mkdtempSync(join(tmpdir(), "reg-out-"))
    try {
      const { symlinkSync } = await import("node:fs")
      symlinkSync(outside, `${root}/evil-test`)
      const spec = { name: "x", description: "d", inputSchema: {}, version: 1 as const, createdAt: 0 }
      const err = await fails(saveTool(root, "https://evil.test", "x", spec, "1"))
      expect(err.reason).toBe("symlink")
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test("env var name is stable contract", () => {
    expect(REGISTRY_ENV).toBe("AGENT_WEBMCP_REGISTRY")
  })
})
