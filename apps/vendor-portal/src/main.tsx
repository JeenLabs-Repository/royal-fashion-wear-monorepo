import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

const container = document.getElementById("root")
if (!container) {
  throw new Error("The root element is missing.")
}

createRoot(container).render(
  <StrictMode>
    <h1 className="txt-large-plus p-6">Vendor portal</h1>
  </StrictMode>
)
