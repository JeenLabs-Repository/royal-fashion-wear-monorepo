import { Button, Heading, Input, Label, Text } from "@medusajs/ui"
import { type FormEvent, useState } from "react"
import { StatusBanner } from "../components/StatusBanner"
import { changePassword } from "../lib/api"
import { errorText } from "../lib/errors"
import { useSession } from "../lib/session"

const MIN_PASSWORD = 12
const MAX_PASSWORD = 128

const Row = ({ label, value, testId }: { label: string; value: string; testId?: string }) => (
  <div className="flex flex-wrap items-start justify-between gap-x-4">
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text size="small" data-testid={testId}>
      {value}
    </Text>
  </div>
)

export const Profile = () => {
  const { me } = useSession()
  const [currentPassword, setCurrentPassword] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pending, setPending] = useState(false)

  const lengthOk = password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD
  const matches = password === confirm
  const valid =
    lengthOk && matches && confirm.length > 0 && currentPassword.length > 0 && Boolean(me)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid || !me) return
    setError(null)
    setSuccess(false)
    setPending(true)
    try {
      await changePassword({ currentPassword, newPassword: password })
      setSuccess(true)
      setCurrentPassword("")
      setPassword("")
      setConfirm("")
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-y-6" data-testid="screen-profile">
      <Heading level="h1">Profile</Heading>

      <section
        className="flex flex-col gap-y-2 rounded-md bg-ui-bg-base p-4 shadow-elevation-card-rest"
        data-testid="profile-account"
      >
        <Heading level="h2">Account</Heading>
        <Row label="Name" value={me?.user.name ?? me?.vendor.contact_name ?? ""} />
        <Row label="Email" value={me?.user.email ?? ""} />
        <Row label="Business name" value={me?.vendor.internal_name ?? ""} />
        <Row
          label="Two-factor sign-in"
          value={me?.mfa_enabled ? "On" : "Not set up"}
          testId="profile-mfa-status"
        />
      </section>

      <section className="flex flex-col gap-y-3 rounded-md bg-ui-bg-base p-4 shadow-elevation-card-rest">
        <Heading level="h2">Change password</Heading>
        {success && (
          <div data-testid="password-success">
            <StatusBanner tone="success">Your password was changed.</StatusBanner>
          </div>
        )}
        <form className="flex max-w-md flex-col gap-y-4" onSubmit={submit} data-testid="password-form">
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="password-current">Current password</Label>
            <Input
              id="password-current"
              data-testid="password-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="password-new">New password</Label>
            <Input
              id="password-new"
              data-testid="password-new"
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
            <Label htmlFor="password-confirm">Confirm new password</Label>
            <Input
              id="password-confirm"
              data-testid="password-confirm"
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
              <Text size="small" className="text-ui-fg-error" data-testid="password-error">
                {error}
              </Text>
            )}
          </div>
          <div>
            <Button
              type="submit"
              isLoading={pending}
              disabled={!valid || pending}
              data-testid="password-submit"
            >
              Change password
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
