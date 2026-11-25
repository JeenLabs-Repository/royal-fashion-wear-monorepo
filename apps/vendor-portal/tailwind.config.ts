import { createRequire } from "node:module"
import path from "node:path"
import type { Config } from "tailwindcss"

const require = createRequire(import.meta.url)

// Resolve the installed UI kit so the content glob works under pnpm, where the
// package sits behind a symlink and a relative node_modules path is not reliable.
const uiDist = path.resolve(path.dirname(require.resolve("@medusajs/ui")), "..")

export default {
  darkMode: "class",
  presets: [require("@medusajs/ui-preset")],
  content: ["./index.html", "./src/**/*.{ts,tsx}", path.join(uiDist, "esm/**/*.js")],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
