import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isSafeRelativePath } from "./safe-path.ts"

describe("isSafeRelativePath accepts plain relative paths", () => {
  for (const value of ["/agreement", "/compliance", "/a/b?x=1", "/", "/a/b#section"]) {
    it(`accepts ${value}`, () => {
      assert.equal(isSafeRelativePath(value), true)
    })
  }
})

describe("isSafeRelativePath refuses hostile values", () => {
  const hostile: [string, string][] = [
    ["a path without a leading slash", "agreement"],
    ["a protocol-relative address", "//evil.example"],
    ["an absolute URL", "https://x"],
    ["a script scheme", "javascript:alert(1)"],
    ["a data scheme", "data:text/html,x"],
    ["a traversal after an empty segment", "/..//x"],
    ["a traversal in the middle", "/a/../b"],
    ["whitespace", "/a b"],
    ["a tab", "/a\tb"],
    ["a backslash", "/a\\b"],
    ["an encoded dot segment", "/%2e%2e/x"],
    ["an encoded slash", "/a%2Fb"],
    ["an empty string", ""],
  ]
  for (const [name, value] of hostile) {
    it(`refuses ${name}`, () => {
      assert.equal(isSafeRelativePath(value), false)
    })
  }
})
