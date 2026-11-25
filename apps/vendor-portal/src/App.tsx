import { Navigate, Route, Routes } from "react-router-dom"
import { Shell } from "./components/Shell"
import { RequireSession, SuspendedScreen, useSession } from "./lib/session"
import { AcceptInvite } from "./screens/AcceptInvite"
import { Agreement } from "./screens/Agreement"
import { Home } from "./screens/Home"
import { Locations } from "./screens/Locations"
import { Login } from "./screens/Login"
import { MfaSetup } from "./screens/MfaSetup"
import { NotFound } from "./screens/NotFound"
import { Profile } from "./screens/Profile"
import { ProductForm } from "./screens/ProductForm"
import { ProductsList } from "./screens/ProductsList"
import { StockScreen } from "./screens/StockScreen"

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
      <Route index element={<Home />} />
      <Route path="agreement" element={<Agreement />} />
      <Route path="locations" element={<Locations />} />
      <Route path="products" element={<ProductsList />} />
      <Route path="products/new" element={<ProductForm />} />
      <Route path="products/:id" element={<ProductForm />} />
      <Route path="stock" element={<StockScreen />} />
      <Route path="profile" element={<Profile />} />
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
)

export default App
