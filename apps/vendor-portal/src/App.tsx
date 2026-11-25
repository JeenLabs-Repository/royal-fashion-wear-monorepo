import { Heading } from "@medusajs/ui"
import { Navigate, Route, Routes } from "react-router-dom"
import { Shell } from "./components/Shell"
import { RequireSession, SuspendedScreen, useSession } from "./lib/session"
import { AcceptInvite } from "./screens/AcceptInvite"
import { Login } from "./screens/Login"
import { MfaSetup } from "./screens/MfaSetup"
import { NotFound } from "./screens/NotFound"

// Placeholders for the screens that arrive with the next portal work. Each keeps a test id.
const Placeholder = ({ name, title }: { name: string; title: string }) => (
  <div data-testid={`screen-${name}`}>
    <Heading level="h1">{title}</Heading>
  </div>
)

const SuspendedRoute = () => {
  const { status } = useSession()
  return status === "suspended" ? <SuspendedScreen /> : <Navigate to="/" replace />
}

const App = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/accept-invite" element={<AcceptInvite />} />
    <Route
      path="/mfa"
      element={
        <RequireSession allowUnenrolled>
          <MfaSetup />
        </RequireSession>
      }
    />
    <Route path="/suspended" element={<SuspendedRoute />} />
    <Route
      element={
        <RequireSession>
          <Shell />
        </RequireSession>
      }
    >
      <Route index element={<Placeholder name="home" title="Home" />} />
      <Route path="agreement" element={<Placeholder name="agreement" title="Agreement" />} />
      <Route path="locations" element={<Placeholder name="locations" title="Locations" />} />
      <Route path="profile" element={<Placeholder name="profile" title="Profile" />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
)

export default App
