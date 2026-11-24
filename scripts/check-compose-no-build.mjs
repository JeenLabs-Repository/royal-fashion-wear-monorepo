// Guards deploy/docker-compose.yml: the production stack runs registry images
// only, publishes no port, holds no database service, keeps Redis persistent
// with noeviction, turns telemetry off and requires every secret to be set.
//
// Usage: node scripts/check-compose-no-build.mjs [--root <dir>]
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const args = process.argv.slice(2)
const rootIndex = args.indexOf("--root")
const root = resolve(rootIndex === -1 ? process.cwd() : args[rootIndex + 1])
const file = join(root, "deploy", "docker-compose.yml")

const REQUIRED_NAMES = [
  "DATABASE_URL",
  "JWT_SECRET",
  "COOKIE_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "AUTH_MFA_ENCRYPTION_KEY",
  "REVALIDATE_SECRET",
  "STORE_CORS",
  "ADMIN_CORS",
  "AUTH_CORS",
  "STOREFRONT_URL",
]

if (!existsSync(file)) {
  console.log(`[FAIL] ${file} does not exist`)
  process.exit(1)
}

const text = readFileSync(file, "utf8")
const lines = text.split("\n")
const results = []
const check = (name, ok, detail = "") => results.push({ name, ok, detail })

const activeLines = lines
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => !line.trim().startsWith("#"))

const findLines = (pattern) =>
  activeLines.filter(({ line }) => pattern.test(line)).map(({ number }) => number)

const buildLines = findLines(/^\s+build:/)
check("no build key", buildLines.length === 0, `line ${buildLines.join(", ")}`)

const portLines = findLines(/^\s*ports:/)
check("no published ports", portLines.length === 0, `line ${portLines.join(", ")}`)

const dbServiceLines = findLines(/^ {2}(postgres|db|database)\s*:\s*$/i)
check("no database service", dbServiceLines.length === 0, `line ${dbServiceLines.join(", ")}`)

check("no database product named in the file", !/postgres/i.test(text))

const badImages = activeLines
  .map(({ line, number }) => ({ match: line.match(/^\s+image:\s*(.+?)\s*$/), number }))
  .filter(({ match }) => match)
  .filter(({ match }) => {
    const value = match[1]
    if (/^\$\{[A-Z_]+_IMAGE:\?/.test(value)) return false
    const tag = value.split(":")[1]
    return !tag || tag === "latest" || tag.startsWith("latest-")
  })
  .map(({ number }) => number)
check("every image is a required variable or has an explicit tag", badImages.length === 0, `line ${badImages.join(", ")}`)

check("telemetry is off", text.includes('GORGO_DISABLE_TELEMETRY: "true"'))
check("redis is append-only", text.includes("--appendonly yes"))
check("redis never evicts", text.includes("noeviction"))
check("no weak default literal", !/supersecret/i.test(text))

for (const name of REQUIRED_NAMES) {
  check(`${name} fails when unset`, text.includes("${" + name + ":?"))
}

let failed = false
for (const { name, ok, detail } of results) {
  if (ok) {
    console.log(`[PASS] ${name}`)
  } else {
    failed = true
    console.log(`[FAIL] ${name}${detail ? ` (${detail})` : ""}`)
  }
}
process.exit(failed ? 1 : 0)
