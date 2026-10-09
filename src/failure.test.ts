import { describe, expect, test } from "bun:test"
import { CliFailure, TransientFailure, asCommandFailure, resolveJson } from "./failure.ts"
import { TransportFailed } from "./transport/errors.ts"

describe("resolveJson", () => {
  test("plain always wins, even on a TTY or with json", () => {
    expect(resolveJson({ json: true, plain: true, isTTY: true })).toBe(false)
    expect(resolveJson({ json: false, plain: true, isTTY: false })).toBe(false)
  })
  test("explicit json wins over TTY", () => {
    expect(resolveJson({ json: true, plain: false, isTTY: true })).toBe(true)
  })
  test("default follows the terminal: rows for humans, JSON for pipes", () => {
    expect(resolveJson({ json: false, plain: false, isTTY: true })).toBe(false)
    expect(resolveJson({ json: false, plain: false, isTTY: false })).toBe(true)
    expect(resolveJson({ json: false, plain: false, isTTY: undefined })).toBe(true)
  })
})

describe("asCommandFailure", () => {
  const transport = (reason: "timeout" | "no-browser" | "protocol" | "flags-missing") =>
    new TransportFailed({ reason, operation: "open", message: "boom" })
  test("timeout and no-browser are transient with a retry hint", () => {
    for (const reason of ["timeout", "no-browser"] as const) {
      const out = asCommandFailure(transport(reason))
      expect(out).toBeInstanceOf(TransientFailure)
      expect(out.message).toMatch(/transient: safe to retry/)
    }
  })
  test("everything else stays CliFailure without the hint", () => {
    for (const reason of ["protocol", "flags-missing"] as const) {
      const out = asCommandFailure(transport(reason))
      expect(out).toBeInstanceOf(CliFailure)
      expect(out.message).not.toMatch(/transient/)
    }
  })
})
