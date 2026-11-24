import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const FILE_NAME = "TEST-CREDENTIALS.local.md"
const TEMPLATE_PATH = path.join("docs", "testing", "test-credentials.template.md")
const TABLE_HEADER = "| What | Flow | Values | How to reset |\n|---|---|---|---|"

type CredentialEntry = {
  /** Section heading without the leading ##, for example "Accounts by role" */
  section: string
  what: string
  /** The spec or flow that created the data */
  flow: string
  reset: string
  values: string
}

function findRepoRoot() {
  let dir = process.cwd()
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error("Could not find pnpm-workspace.yaml above the working directory.")
    }
    dir = parent
  }
}

// The file must be ignored before it exists.
function assertIgnored(root: string) {
  try {
    execFileSync("git", ["check-ignore", "-q", FILE_NAME], { cwd: root, stdio: "ignore" })
  } catch {
    throw new Error(
      `${FILE_NAME} is not ignored by git, or git is unavailable. Add it to .gitignore first.`
    )
  }
}

function cell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim()
}

export function appendCredentialEntry(entry: CredentialEntry) {
  const root = findRepoRoot()
  assertIgnored(root)

  const filePath = path.join(root, FILE_NAME)
  const text = existsSync(filePath)
    ? readFileSync(filePath, "utf8")
    : readFileSync(path.join(root, TEMPLATE_PATH), "utf8")

  const row = `| ${cell(entry.what)} | ${cell(entry.flow)} | ${cell(entry.values)} | ${cell(entry.reset)} |`
  const heading = `## ${entry.section}`
  const lines = text.split("\n")
  const start = lines.findIndex((line) => line.trim() === heading)

  if (start === -1) {
    const tail = text.endsWith("\n") ? "" : "\n"
    writeFileSync(filePath, `${text}${tail}\n${heading}\n\n${TABLE_HEADER}\n${row}\n`)
    return
  }

  let end = lines.findIndex((line, index) => index > start && line.startsWith("## "))
  if (end === -1) end = lines.length
  let last = end - 1
  while (last > start && lines[last].trim() === "") last -= 1

  const hasTable = lines.slice(start, end).some((line) => line.includes("|---|"))
  lines.splice(last + 1, 0, ...(hasTable ? [row] : ["", ...TABLE_HEADER.split("\n"), row]))
  writeFileSync(filePath, lines.join("\n"))
}
