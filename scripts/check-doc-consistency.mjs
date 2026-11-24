// Guards the project guide and the READMEs against statements that no longer
// hold: package manager neutrality, weak default secrets, the old language and
// country scope, a Node 20 allowance, template framing, removed features and
// the old commit format. Also checks required statements and that every Node 22
// version string matches .nvmrc.
//
// Usage: node scripts/check-doc-consistency.mjs [--root <dir>] [--count] [--only <file>]
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const root = resolve(option("--root") ?? process.cwd())
const only = option("--only")
const countOnly = flag("--count")

const DOCS = [
  "AGENTS.md",
  "README.md",
  "apps/backend/README.md",
  "apps/storefront/README.md",
]

const FORBIDDEN = [
  { name: "package manager neutrality", pattern: /npm and yarn|npm, yarn|under npm|\byarn\b/i },
  { name: "weak default secret", pattern: /supersecret/i },
  { name: "the number 36", pattern: /\b36\b/ },
  { name: "the number 241", pattern: /\b241\b/ },
  { name: "Node 20 allowance", pattern: /\bNode(?:\.js)?\s*v?20\b|(?<![\d.])20\.19\b|>=\s*20\b/ },
  { name: "shop owner framing", pattern: /shop owner/i },
  { name: "removed address or country lookup", pattern: /dadata|geolocation|country detection|ip-api/i },
  { name: "template installer", pattern: /create-medusa-app|--repo-url/ },
  { name: "template update or demo reference", pattern: /medusa-update-action|notify-deploy|dtc-starter-demo|\bupstream\b/i },
  { name: "right-to-left support", pattern: /\brtl\b|right-to-left/i },
  { name: "old commit format", pattern: /no trailers|no body/i },
  { name: "empty providers instruction", pattern: /leave the array empty|empty\s+`?providers`?\s+array|providers[^.\n]*empty[^.\n]*on purpose|empty[^.\n]*providers[^.\n]*on purpose/i },
]

const REQUIRED = {
  "AGENTS.md": ["pnpm", "22.23.4", "active-dev", "CLAUDE.md", ".cursor/rules", "docs/"],
  "README.md": ["22.23.4", "docker-compose.dev.yml", "deploy-dokploy"],
}

const read = (relativePath) => {
  const full = join(root, relativePath)
  return existsSync(full) ? readFileSync(full, "utf8") : null
}

const findings = []
let forbiddenCount = 0

const files = DOCS.filter((file) => !only || file === only)

for (const file of files) {
  const text = read(file)
  if (text === null) {
    findings.push(`[FAIL] ${file}: file is missing`)
    continue
  }
  text.split("\n").forEach((line, index) => {
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(line)) {
        forbiddenCount += 1
        findings.push(`[FAIL] ${file}:${index + 1} ${rule.name}`)
      }
    }
  })
}

if (countOnly) {
  console.log(String(forbiddenCount))
  process.exit(forbiddenCount === 0 ? 0 : 1)
}

for (const file of files) {
  const text = read(file)
  if (text === null) continue
  for (const needle of REQUIRED[file] ?? []) {
    if (!text.includes(needle)) {
      findings.push(`[FAIL] ${file}: required text "${needle}" is missing`)
    }
  }
}

const nvmrc = read(".nvmrc")
if (nvmrc === null) {
  findings.push("[FAIL] .nvmrc: file is missing")
} else {
  const pinned = nvmrc.split("\n")[0].trim()
  for (const file of files) {
    const text = read(file)
    if (text === null) continue
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(/(?<![\d.])22\.\d+\.\d+/g)) {
        if (match[0] !== pinned) {
          findings.push(`[FAIL] ${file}:${index + 1} node version ${match[0]} differs from .nvmrc (${pinned})`)
        }
      }
    })
  }
}

if (findings.length === 0) {
  console.log("[PASS] documentation statements are consistent")
  process.exit(0)
}
for (const finding of findings) console.log(finding)
process.exit(1)
