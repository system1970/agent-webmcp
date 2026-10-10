// Classifier + strict tests: pure matrices, no browser.
import { describe, expect, test } from "bun:test"
import { checkStrict, classifyCallFailure } from "./classify.ts"

describe("classifier", () => {
  test("absent from catalog is tool-vanished", () => {
    const c = classifyCallFailure({ toolName: "gone", inCatalog: false, reason: "page", message: "x" })
    expect(c.code).toBe("tool-vanished")
    expect(c.guidance).toMatch(/re-list/)
  })

  test("timeout/connect is transport", () => {
    for (const reason of ["timeout", "connect"]) {
      const c = classifyCallFailure({ toolName: "t", inCatalog: true, reason, message: "wedged" })
      expect(c.code).toBe("transport")
    }
  })

  test("schema-ish messages are args-rejected", () => {
    const c = classifyCallFailure({ toolName: "t", inCatalog: true, reason: "page", message: "missing required field foo" })
    expect(c.code).toBe("args-rejected")
  })

  test("other page failures are page-refused", () => {
    const c = classifyCallFailure({ toolName: "t", inCatalog: true, reason: "page", message: "blew up" })
    expect(c.code).toBe("page-refused")
    expect(c.guidance).toMatch(/suspect/)
  })
})

describe("strict", () => {
  test("unknown keys reported, known pass", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } }
    expect(checkStrict(schema, { a: "x", b: 1 })).toEqual(["b"])
    expect(checkStrict(schema, { a: "x" })).toEqual([])
  })

  test("non-object schemas and args skip (no opinion)", () => {
    expect(checkStrict({ type: "string" }, { a: 1 })).toEqual([])
    expect(checkStrict({ type: "object", properties: {} }, [1, 2])).toEqual([])
    expect(checkStrict(null, { a: 1 })).toEqual([])
  })
})
