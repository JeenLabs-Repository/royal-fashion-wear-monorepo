import { Button, Heading, Text } from "@medusajs/ui"
import type { ReactNode } from "react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { useSession } from "../lib/session"

const LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/products", label: "Products", end: false },
  { to: "/agreement", label: "Agreement", end: false },
  { to: "/locations", label: "Locations", end: false },
  { to: "/profile", label: "Profile", end: false },
]

// A centered card for the screens a vendor sees before sign-in.
export const AuthFrame = ({ title, children }: { title: string; children: ReactNode }) => (
  <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-y-6 p-6">
    <Heading level="h1">{title}</Heading>
    {children}
  </main>
)

export const Shell = () => {
  const { me, signOut } = useSession()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    try {
      await signOut()
    } finally {
      navigate("/login", { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden">
      <header className="border-b border-ui-border-base bg-ui-bg-base">
        <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Heading level="h2">Vendor portal</Heading>
          <div className="flex flex-wrap items-center gap-3">
            <Text
              size="small"
              leading="compact"
              className="text-ui-fg-subtle"
              data-testid="signed-in-email"
            >
              {me?.user.email}
            </Text>
            <Button
              size="small"
              variant="secondary"
              onClick={() => void handleSignOut()}
              data-testid="sign-out"
            >
              Sign out
            </Button>
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto flex w-full min-w-0 max-w-5xl gap-x-4 overflow-x-auto px-4">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-1 py-2 txt-small-plus outline-none focus-visible:shadow-borders-interactive-with-focus ${
                  isActive
                    ? "border-ui-fg-base text-ui-fg-base"
                    : "border-transparent text-ui-fg-subtle hover:text-ui-fg-base"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
