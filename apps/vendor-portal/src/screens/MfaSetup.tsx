import { Button, Checkbox, Input, Label, Text } from "@medusajs/ui"
import { QRCodeSVG } from "qrcode.react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { AuthFrame } from "../components/Shell"
import { type Enrolment, startEnrolment, verifyEnrolment } from "../lib/api"
import { toApiError } from "../lib/errors"
import { useSession } from "../lib/session"

type Step = "starting" | "verify" | "codes"

const buildUri = (setup: Enrolment, email: string): string =>
  setup.otpauthUri ??
  `otpauth://totp/Vendor%20portal:${encodeURIComponent(email)}?secret=${setup.secret}&issuer=Vendor%20portal`

export const MfaSetup = () => {
  const navigate = useNavigate()
  const { me, refresh, signOut } = useSession()
  // Snapshot at the first render: after the factor is confirmed the identity
  // query may flip to enrolled, which must not skip the recovery codes.
  const alreadyEnrolled = useRef(me?.mfa_enabled === true)
  const started = useRef(false)

  const [step, setStep] = useState<Step>("starting")
  const [setup, setSetup] = useState<Enrolment | null>(null)
  const [code, setCode] = useState("")
  const [codes, setCodes] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)

  const begin = async () => {
    setError(null)
    setPending(true)
    try {
      setSetup(await startEnrolment())
      setStep("verify")
    } catch (failure) {
      setError(toApiError(failure).message)
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    if (alreadyEnrolled.current || started.current) return
    started.current = true
    void begin()
  }, [])

  if (alreadyEnrolled.current) {
    return <Navigate to="/" replace />
  }

  const verify = async (event: FormEvent) => {
    event.preventDefault()
    if (!setup) return
    setError(null)
    setPending(true)
    try {
      setCodes(await verifyEnrolment(setup.factorId, code.replace(/\s/g, "")))
      setStep("codes")
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const signInAgain = async () => {
    try {
      await signOut()
    } finally {
      navigate("/login", {
        replace: true,
        state: { notice: "Two-factor sign-in is set up. Sign in again to continue." },
      })
    }
  }

  const proceed = async () => {
    setPending(true)
    try {
      const fresh = await refresh()
      // The recorded behavior decides this branch: if the current token
      // does not report two-factor yet, a fresh sign-in is required.
      if (fresh?.mfa_enabled) {
        navigate("/", { replace: true })
      } else {
        await signInAgain()
      }
    } finally {
      setPending(false)
    }
  }

  if (step === "starting") {
    return (
      <AuthFrame title="Set up two-factor sign-in">
        {error ? (
          <>
            <Text className="text-ui-fg-error" role="alert" data-testid="mfa-error">
              {error}
            </Text>
            <div>
              <Button variant="secondary" onClick={() => void begin()} isLoading={pending}>
                Try again
              </Button>
            </div>
          </>
        ) : (
          <Text className="text-ui-fg-subtle" role="status">
            Preparing your setup key.
          </Text>
        )}
      </AuthFrame>
    )
  }

  if (step === "verify" && setup) {
    return (
      <AuthFrame title="Set up two-factor sign-in">
        <Text className="text-ui-fg-subtle">
          Scan the code with an authenticator app, or type the setup key into it. Then enter the
          6-digit code the app shows.
        </Text>
        <div className="flex flex-col gap-y-3">
          <div className="w-fit rounded-md bg-white p-3" aria-hidden="true">
            <QRCodeSVG value={buildUri(setup, me?.user.email ?? "vendor")} size={160} />
          </div>
          <div className="flex flex-col gap-y-1">
            <Text size="small" weight="plus">
              Setup key
            </Text>
            <code className="break-all rounded-md bg-ui-bg-component p-2 txt-small" data-testid="mfa-secret">
              {setup.secret}
            </code>
          </div>
        </div>
        <form className="flex flex-col gap-y-4" onSubmit={verify}>
          <div className="flex flex-col gap-y-1">
            <Label htmlFor="mfa-code">6-digit code</Label>
            <Input
              id="mfa-code"
              data-testid="mfa-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div aria-live="polite">
            {error && (
              <Text size="small" className="text-ui-fg-error" data-testid="mfa-error">
                {error}
              </Text>
            )}
          </div>
          <Button
            type="submit"
            isLoading={pending}
            disabled={pending || code.replace(/\s/g, "").length < 6}
            data-testid="mfa-verify"
          >
            Verify and continue
          </Button>
        </form>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title="Save your recovery codes">
      <Text className="text-ui-fg-subtle">
        Each code works once if you lose your authenticator. They are shown only now, so store them
        somewhere safe.
      </Text>
      <ul className="grid grid-cols-2 gap-2 rounded-md bg-ui-bg-component p-3 txt-small" data-testid="recovery-codes">
        {codes.map((recovery) => (
          <li key={recovery}>
            <code>{recovery}</code>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-x-3">
        <Button size="small" variant="secondary" onClick={() => void copy()}>
          Copy codes
        </Button>
        {copied && (
          <Text size="small" className="text-ui-fg-subtle" role="status">
            Copied
          </Text>
        )}
      </div>
      <div className="flex items-center gap-x-2">
        <Checkbox
          id="recovery-saved"
          data-testid="recovery-saved"
          checked={saved}
          onCheckedChange={(value) => setSaved(value === true)}
        />
        <Label htmlFor="recovery-saved">I have saved these codes</Label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!saved || pending}
          isLoading={pending}
          onClick={() => void proceed()}
          data-testid="mfa-continue"
        >
          Continue
        </Button>
        <Button
          variant="secondary"
          disabled={!saved || pending}
          onClick={() => void signInAgain()}
          data-testid="mfa-sign-in-again"
        >
          Sign in again instead
        </Button>
      </div>
    </AuthFrame>
  )
}
