import { Button, Input, Label, Text } from "@medusajs/ui"
import { type FormEvent, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AuthFrame } from "../components/Shell"
import { acceptInvite } from "../lib/api"
import { toApiError } from "../lib/errors"

const MIN_PASSWORD = 12
const MAX_PASSWORD = 128
const INVALID_LINK = "This invitation link is not valid or has expired. Ask the store for a new one."

// The invitation token travels in the address fragment, which browsers never
// send to a server. It is read once, the address is cleaned at once, and the
// value lives only in this variable. A module variable (not state) makes the
// read happen once even when React runs an effect twice in development.
let pendingToken: string | null | undefined

const takeToken = (): string | null => {
  if (pendingToken === undefined) {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""))
    const found = fragment.get("token")
    // Real invitation tokens are long base64url values. A short fragment is treated
    // as missing so the screen shows the generic invalid-link message with no form.
    pendingToken = found && found.length >= 16 ? found : null
    window.history.replaceState(null, "", window.location.pathname)
  }
  return pendingToken
}

export const AcceptInvite = () => {
  const navigate = useNavigate()
  const [token] = useState<string | null>(takeToken)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!token) {
    return (
      <AuthFrame title="Invitation">
        <div role="alert" data-testid="accept-error">
          <Text className="text-ui-fg-error">{INVALID_LINK}</Text>
        </div>
      </AuthFrame>
    )
  }

  const lengthOk = password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD
  const matches = password === confirm
  const valid = lengthOk && matches && confirm.length > 0

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    setError(null)
    setPending(true)
    try {
      await acceptInvite({ token, password })
      pendingToken = null
      navigate("/login", {
        replace: true,
        state: { notice: "Account created. Sign in to continue." },
      })
    } catch (failure) {
      const problem = toApiError(failure)
      // The server refuses every bad link with one message, and so does this screen.
      setError(problem.status === 400 ? INVALID_LINK : problem.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthFrame title="Set your password">
      <form className="flex flex-col gap-y-4" onSubmit={submit} data-testid="accept-form">
        <Text className="text-ui-fg-subtle">
          Choose a password of {MIN_PASSWORD} to {MAX_PASSWORD} characters. You will set up
          two-factor sign-in after you sign in.
        </Text>
        <div className="flex flex-col gap-y-1">
          <Label htmlFor="accept-password">Password</Label>
          <Input
            id="accept-password"
            data-testid="accept-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {password.length > 0 && !lengthOk && (
            <Text size="small" className="text-ui-fg-error">
              Use {MIN_PASSWORD} to {MAX_PASSWORD} characters.
            </Text>
          )}
        </div>
        <div className="flex flex-col gap-y-1">
          <Label htmlFor="accept-confirm">Confirm password</Label>
          <Input
            id="accept-confirm"
            data-testid="accept-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {confirm.length > 0 && !matches && (
            <Text size="small" className="text-ui-fg-error">
              The passwords do not match.
            </Text>
          )}
        </div>
        <div aria-live="polite">
          {error && (
            <Text size="small" className="text-ui-fg-error" data-testid="accept-error">
              {error}
            </Text>
          )}
        </div>
        <Button type="submit" isLoading={pending} disabled={!valid || pending} data-testid="accept-submit">
          Create account
        </Button>
      </form>
    </AuthFrame>
  )
}
