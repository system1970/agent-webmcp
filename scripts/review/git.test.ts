import { describe, test, expect } from "bun:test"
import { parseNumstat, computeTier, expandRename } from "./git.ts"

describe("parseNumstat", () => {
  test("sums added+deleted and lists files", () => {
    const r = parseNumstat("10\t2\tsrc/a.ts\n0\t5\tsrc/b.ts\n")
    expect(r.diffLines).toBe(17)
    expect(r.names).toEqual(["src/a.ts", "src/b.ts"])
  })
  test("binary dashes count zero, blank lines skipped", () => {
    const r = parseNumstat("-\t-\tbin/blob\n3\t0\tsrc/c.ts\n\n")
    expect(r.diffLines).toBe(3)
    expect(r.names).toEqual(["bin/blob", "src/c.ts"])
  })
  test("renames expand to the new path", () => {
    const r = parseNumstat("1\t1\tsrc/{commands => }/failure.ts\n")
    expect(r.diffLines).toBe(2)
    expect(r.names).toEqual(["src/failure.ts"])
  })
})

describe("expandRename", () => {
  test("plain paths pass through", () => {
    expect(expandRename("src/a.ts")).toBe("src/a.ts")
  })
  test("same-dir rename", () => {
    expect(expandRename("src/{old => new}.ts")).toBe("src/new.ts")
  })
  test("emptied segment collapses slashes", () => {
    expect(expandRename("src/{commands => }/failure.ts")).toBe("src/failure.ts")
  })
})

describe("computeTier", () => {
  test("10 lines is trivial", () => {
    expect(computeTier(10, ["src/a.ts"])).toEqual({ tier: "trivial", hot: false })
  })
  test("11 lines is lite", () => {
    expect(computeTier(11, ["src/a.ts"]).tier).toBe("lite")
  })
  test("400 lines is lite", () => {
    expect(computeTier(400, ["src/a.ts"]).tier).toBe("lite")
  })
  test("401 lines is full", () => {
    expect(computeTier(401, ["src/a.ts"]).tier).toBe("full")
  })
  test("hot path forces full on a small diff", () => {
    expect(computeTier(30, ["src/budgets.ts"])).toEqual({ tier: "full", hot: true })
  })
  test("hot forces full even at trivial size", () => {
    expect(computeTier(5, ["src/transport/client.ts"])).toEqual({ tier: "full", hot: true })
  })
  test("prefix lookalikes are not hot", () => {
    expect(computeTier(30, ["src/transport2/x.ts"]).hot).toBe(false)
  })
})
