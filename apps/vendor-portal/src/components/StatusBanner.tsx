import { Alert } from "@medusajs/ui"
import type { ReactNode } from "react"

type Tone = "info" | "success" | "warning" | "error"

export const StatusBanner = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <div data-testid="status-banner" role={tone === "error" ? "alert" : "status"}>
    <Alert variant={tone}>{children}</Alert>
  </div>
)
