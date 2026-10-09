import { describe, test, expect } from "bun:test"
import { sha12, cacheKey } from "./cache.ts"

describe("sha12", () => {
  test("known vector", () => {
    expect(sha12("test")).toBe("9f86d081884c")
  })
})

describe("cacheKey", () => {
  test("unstaged", () => {
    expect(cacheKey("abc123", false, "def45678")).toBe("abc123+def45678")
  })
  test("staged tag", () => {
    expect(cacheKey("abc123", true, "def45678")).toBe("abc123-staged+def45678")
  })
  test("plan sha truncated to 8", () => {
    expect(cacheKey("a", false, "1234567890abcdef")).toBe("a+12345678")
  })
})
