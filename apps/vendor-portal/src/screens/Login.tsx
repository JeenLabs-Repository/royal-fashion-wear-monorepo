import { Button, Input, Label, Text } from "@medusajs/ui"
import { useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { AuthFrame } from "../components/Shell"
import { StatusBanner } from "../components/StatusBanner"
import { answerChallenge, getMe, passwordLogin } from "../lib/api"
import { toApiError } from "../lib/errors"
import { setToken as storeToken } from "../lib/sdk"
import { ME_KEY } from "../lib/session"

const WRONG_CREDENTIALS = "Email or password is incorrect."

export const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const notice = (location.state as { notice?: string } | null)?.notice ?? null

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [firstFactorToken, setFirstFactorToken] = useState<string | null>(null)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [challengeMethod, setChallengeMethod] = useState("totp")
  const [code, setCode] = useState("")
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const finish = async (sessionToken: string) => {
    // Keep the token in memory only, then wait for the identity query so the
    // guards see the new sign-in before the redirect.
    storeToken(sessionToken)
    try {
      await queryClient.fetchQuery({ queryKey: ME_KEY, queryFn: getMe })
      navigate("/", { replace: true })
    } catch (failure) {
      const problem = toApiError(failure)
      // A suspended account may still sign in far enough to learn the status;
      // send them to the suspended screen instead of leaving them on the form.
      if (problem.status === 403 && problem.code === "vendor_suspended") {
        navigate("/suspended", { replace: true })
        return
      }
      throw failure
    }
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      const result = await passwordLogin(email.trim(), password)
      if (result.challenge && result.challengeId) {
        setFirstFactorToken(result.token)
        setChallengeId(result.challengeId)
        setChallengeMethod(result.challengeMethod ?? "totp")
      } else {
        await finish(result.token)
      }
    } catch (failure) {
      const problem = toApiError(failure)
      // One message for every refusal, so the form never says which part was wrong.
      setError(
        problem.status === 401 || problem.status === 400 ? WRONG_CREDENTIALS : problem.message
      )
    } finally {
      setPending(false)
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    if (!firstFactorToken || !challengeId) return
    setError(null)
    setPending(true)
    try {
      const method = useRecovery ? "recovery_code" : challengeMethod
      const sessionToken = await answerChallenge(firstFactorToken, challengeId, {
        method,
        code: code.trim().replace(/\s/g, ""),
      })
      await finish(sessionToken)
    } catch (failure) {
      const problem = toApiError(failure)
      setError(
        problem.status >= 400 && problem.status < 500
          ? "That code was not accepted. Try again."
          : problem.message
      )
    } finally {
      setPending(false)
    }
  }

  if (firstFactorToken && challengeId) {
    return (
      <AuthFrame title="Enter your code">
        <form className="flex flex-col gap-y-4" onSubmit={submitCode} data-testid="login-code-form">
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="login-code">
              {useRecovery ? "Recovery code" : "6-digit code from your authenticator app"}
            </Label>
            <Input
              id="login-code"
              data-testid="login-code"
              autoComplete="one-time-code"
              inputMode={useRecovery ? "text" : "numeric"}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div aria-live="polite">
            {error && (
              <Text size="small" className="text-ui-fg-error" data-testid="login-error">
                {error}
              </Text>
            )}
          </div>
          <Button
            type="submit"
            isLoading={pending}
            disabled={pending || code.trim().length === 0}
            data-testid="login-code-submit"
          >
            Continue
          </Button>
          <button
            type="button"
            className="self-start text-ui-fg-interactive txt-small-plus"
            onClick={() => {
              setUseRecovery((current) => !current)
              setCode("")
              setError(null)
            }}
          >
            {useRecovery ? "Use an authenticator code instead" : "Use a recovery code instead"}
          </button>
        </form>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title="Sign in">
      {notice && <StatusBanner tone="success">{notice}</StatusBanner>}
      <form className="flex flex-col gap-y-4" onSubmit={submitPassword} data-testid="login-form">
        <div className="flex flex-col gap-y-1">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            data-testid="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-y-1">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            data-testid="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div aria-live="polite">
          {error && (
            <Text size="small" className="text-ui-fg-error" data-testid="login-error">
              {error}
            </Text>
          )}
        </div>
        <Button
          type="submit"
          isLoading={pending}
          disabled={pending || email.trim().length === 0 || password.length === 0}
          data-testid="login-submit"
        >
          Sign in
        </Button>
      </form>
    </AuthFrame>
  )
}
