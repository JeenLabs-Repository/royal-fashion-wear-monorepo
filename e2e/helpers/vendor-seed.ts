import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

// One record of the seed file written by the demo vendor seed. Only the keys the
// browser specs read are typed here.
export type SeedRecord = {
  key: string
  internal_name: string
  email: string
  password: string
  status: string
  registered: boolean
  accept_url: string | null
  locations: { code: string; state_code: string; pin: string }[]
}

// Shape of e2e/.auth/vendor-seed.json.
export type VendorSeedFile = {
  generated_at: string
  portal_url: string
  vendors: Record<string, SeedRecord>
  fresh_invite: SeedRecord | null
}

export type FreshInvite = {
  inviteLink: string
  email: string
  password: string
}

const repoRoot = (): string => {
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

// Reads the seed file as the demo vendor seed wrote it.
export const readVendorSeed = (): VendorSeedFile => {
  const file = path.join(repoRoot(), "e2e", ".auth", "vendor-seed.json")
  if (!existsSync(file)) {
    throw new Error(
      "e2e/.auth/vendor-seed.json was not written. Run the demo vendor seed and check its output."
    )
  }
  return JSON.parse(readFileSync(file, "utf8")) as VendorSeedFile
}

// Creates one more invited vendor with the demo seed and returns its link. The
// seed refuses to run in production and rewrites e2e/.auth/vendor-seed.json,
// whose fresh_invite key always holds the newest invited vendor.
export const seedFreshVendor = (): FreshInvite => {
  // pnpm inserts its own `--` boundary; pass another so medusa exec receives
  // --fresh-invite as a script argument (same pattern as the staff CLI).
  execFileSync(
    "pnpm",
    [
      "-C",
      "apps/backend",
      "exec",
      "medusa",
      "exec",
      "./src/scripts/seed-vendors.ts",
      "--",
      "--fresh-invite",
    ],
    { cwd: repoRoot(), encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" }
  )
  const fresh = readVendorSeed().fresh_invite
  if (!fresh || !fresh.accept_url || !fresh.accept_url.includes("#token=")) {
    throw new Error(
      "The seed file holds no fresh_invite with an accept_url that carries a #token= fragment."
    )
  }
  return { inviteLink: fresh.accept_url, email: fresh.email, password: fresh.password }
}
