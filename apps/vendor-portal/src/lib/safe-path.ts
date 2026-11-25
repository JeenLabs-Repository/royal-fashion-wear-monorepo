// A link that comes from the server must be a plain relative portal path before
// it becomes navigation. Everything else (a scheme, a host, a traversal, an
// encoded dot or slash, whitespace, a backslash) is refused.
export const isSafeRelativePath = (value: string): boolean => {
  if (typeof value !== "string" || value.length === 0) {
    return false
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return false
  }
  if (/[\s\\\u0000-\u001f]/.test(value)) {
    return false
  }
  const pathOnly = value.split(/[?#]/)[0]
  if (pathOnly.split("/").includes("..")) {
    return false
  }
  if (/%2e|%2f|%5c/i.test(pathOnly)) {
    return false
  }
  return true
}
