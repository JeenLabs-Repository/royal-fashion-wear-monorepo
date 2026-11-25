import { Button, Heading, Text } from "@medusajs/ui"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, createContext, useContext } from "react"
import { Navigate } from "react-router-dom"
import { type Me, endSession, getMe } from "./api"
import { ApiError, toApiError } from "./errors"

export const ME_KEY = ["session", "me"] as const

export type SessionStatus = "loading" | "anonymous" | "needs_mfa" | "suspended" | "ready" | "error"

type SessionValue = {
  status: SessionStatus
  me: Me | null
  errorMessage: string | null
  refresh: () => Promise<Me | null>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

const statusFor = (isLoading: boolean, error: unknown, data: Me | undefined): SessionStatus => {
  if (isLoading) return "loading"
  // The error is read first: after a failed refetch the query keeps its last data.
  if (error) {
    const failure = error instanceof ApiError ? error : toApiError(error)
    if (failure.status === 401) return "anonymous"
    if (failure.status === 403 && failure.code === "vendor_suspended") return "suspended"
    return "error"
  }
  if (data) return data.mfa_enabled ? "ready" : "needs_mfa"
  return "error"
}

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ME_KEY, queryFn: getMe, retry: false })

  // Asks again who is signed in and returns the answer, or null when the request failed.
  const refresh = async (): Promise<Me | null> => {
    try {
      return await queryClient.fetchQuery({ queryKey: ME_KEY, queryFn: getMe, staleTime: 0 })
    } catch {
      return null
    }
  }

  const signOut = async () => {
    try {
      endSession()
    } finally {
      // Drop everything cached for the vendor, then re-ask who is signed in.
      queryClient.removeQueries({ predicate: (candidate) => candidate.queryKey[0] !== ME_KEY[0] })
      await queryClient.invalidateQueries({ queryKey: ME_KEY })
    }
  }

  const value: SessionValue = {
    status: statusFor(query.isLoading, query.error, query.data),
    me: query.error ? null : (query.data ?? null),
    errorMessage: query.error ? toApiError(query.error).message : null,
    refresh,
    signOut,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = (): SessionValue => {
  const value = useContext(SessionContext)
  if (!value) {
    throw new Error("useSession must be used inside SessionProvider.")
  }
  return value
}

export const SuspendedScreen = () => {
  const { signOut } = useSession()
  return (
    <main
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-y-4 p-6"
      data-testid="suspended-screen"
    >
      <Heading level="h1">Your account is suspended</Heading>
      <Text className="text-ui-fg-subtle">
        The store has suspended your vendor account. You cannot use the portal until the store team
        reactivates it. Contact the store to find out more.
      </Text>
      <div>
        <Button variant="secondary" onClick={() => void signOut()} data-testid="sign-out">
          Sign out
        </Button>
      </div>
    </main>
  )
}

type RequireSessionProps = {
  children: ReactNode
  // The enrolment screen is the one place a signed-in vendor without two-factor may stand.
  allowUnenrolled?: boolean
}

export const RequireSession = ({ children, allowUnenrolled = false }: RequireSessionProps) => {
  const { status, errorMessage, refresh } = useSession()

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <span
          role="status"
          aria-label="Loading"
          className="size-5 animate-spin rounded-full border-2 border-ui-border-strong border-t-ui-fg-base"
        />
      </main>
    )
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace />
  }
  if (status === "suspended") {
    return <SuspendedScreen />
  }
  if (status === "error") {
    return (
      <main
        className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-y-4 p-6"
        data-testid="session-error"
      >
        <Heading level="h1">The portal could not load</Heading>
        <Text className="text-ui-fg-error" role="alert">
          {errorMessage ?? "Something went wrong. Try again."}
        </Text>
        <div>
          <Button variant="secondary" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      </main>
    )
  }
  if (status === "needs_mfa" && !allowUnenrolled) {
    return <Navigate to="/mfa" replace />
  }
  return <>{children}</>
}
