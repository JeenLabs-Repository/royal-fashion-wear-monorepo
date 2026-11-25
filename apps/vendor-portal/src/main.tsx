import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import "./index.css"
import { SessionProvider } from "./lib/session"

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

const container = document.getElementById("root")
if (!container) {
  throw new Error("The root element is missing.")
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
