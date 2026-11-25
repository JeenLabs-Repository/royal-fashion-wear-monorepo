import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const backend = process.env.VITE_BACKEND_URL ?? "http://localhost:9000"

// In production the backend serves the built portal under /vendor-portal/ and
// answers these three API prefixes itself, so the dev proxy forwards exactly
// them. Each key is an anchored expression: a plain "/vendor"
// key is a prefix match and would also capture /vendor-portal/, the portal's
// own address.
const proxied = ["/vendor", "/auth/vendor", "/auth/mfa"]

export default defineConfig({
  base: "/vendor-portal/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      proxied.map((prefix) => [`^${prefix}(/|$)`, { target: backend, changeOrigin: false }])
    ),
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
})
