import { describe, test, expect } from "bun:test"
import { parseVerdict, gateRed } from "./verdict.ts"

describe("parseVerdict", () => {
  test("exact verdict line", () => {
    expect(parseVerdict("findings above.\nVerdict: 2 BLOCKING, 1 SHOULD-FIX, 0 NIT")).toBe(2)
  })
  test("zero blocking", () => {
    expect(parseVerdict("Verdict: 0 BLOCKING, 3 SHOULD-FIX, 5 NIT")).toBe(0)
  })
  test("case-insensitive, confirmed suffix", () => {
    expect(parseVerdict("verdict: 1 blocking (confirmed)")).toBe(1)
  })
  test("no-blocking prose", () => {
    expect(parseVerdict("No BLOCKING. Merge direction matches the research.")).toBe(0)
  })
  test("missing verdict is null (advisory, never green-by-default)", () => {
    expect(parseVerdict("## SHOULD-FIX\n- `src/a.ts:1` — something")).toBeNull()
  })
})

describe("gateRed", () => {
  test("null is red (unconfirmable, fail closed)", () => {
    expect(gateRed(null, null)).toBe(true)
  })
  test("zero blocking is green", () => {
    expect(gateRed(0, 0)).toBe(false)
  })
  test("confirmed blocking is red", () => {
    expect(gateRed(2, 2)).toBe(true)
  })
  test("verifier-cleared is green", () => {
    expect(gateRed(2, 0)).toBe(false)
  })
  test("unverified blocking stands", () => {
    expect(gateRed(1, null)).toBe(true)
  })
})
