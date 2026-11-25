import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// The vendor portal keeps the sign-in token in memory only. This guard fails
// when portal source touches browser storage or cookies, or asks the browser to
// send credentials, so a change cannot quietly bring a cookie session back.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceDir = path.join(root, "apps", "vendor-portal", "src")

const FORBIDDEN = [
  { pattern: /\blocalStorage\b/, label: "localStorage" },
  { pattern: /\bsessionStorage\b/, label: "sessionStorage" },
  { pattern: /\bdocument\.cookie\b/, label: "document.cookie" },
  { pattern: /\bindexedDB\b/, label: "indexedDB" },
  { pattern: /credentials:\s*["']include["']/, label: 'credentials: "include"' },
]

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [full] : []
  })

const failures = []
for (const file of walk(sourceDir)) {
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, index) => {
    for (const { pattern, label } of FORBIDDEN) {
      if (pattern.test(line)) {
        failures.push(`${path.relative(root, file)}:${index + 1} uses ${label}`)
      }
    }
  })
}

if (failures.length > 0) {
  console.error("[check-portal-storage] the portal must keep its token in memory only:")
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log("[check-portal-storage] ok")
