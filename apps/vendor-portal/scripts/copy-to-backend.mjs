// Copies the finished build into the directory the backend serves at
// /vendor-portal/. The old copy is removed first so a deleted asset never lingers.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(here, "..", "dist")
const target = path.resolve(here, "..", "..", "backend", "static", "vendor-portal")

if (!existsSync(path.join(dist, "index.html"))) {
  console.error("The portal build is missing dist/index.html; run vite build first.")
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(dist, target, { recursive: true })
console.log(`Copied the portal build to ${target}`)
