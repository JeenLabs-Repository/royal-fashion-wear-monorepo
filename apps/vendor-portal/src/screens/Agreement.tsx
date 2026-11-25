import { Button, Checkbox, Heading, Label, Text } from "@medusajs/ui"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { MarkdownDocument } from "../components/MarkdownDocument"
import { StatusBanner } from "../components/StatusBanner"
import { acceptAgreement, getAgreement, portalKeys } from "../lib/api"
import { ApiError, errorText, toApiError } from "../lib/errors"

const docTestId = (key: string) => `agreement-doc-${key.replace(/_/g, "-")}`

export const Agreement = () => {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const agreement = useQuery({
    queryKey: portalKeys.agreement,
    queryFn: getAgreement,
    retry: false,
  })

  const accept = useMutation({
    mutationFn: (version: string) => acceptAgreement(version),
    onSuccess: async () => {
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: portalKeys.agreement }),
        queryClient.invalidateQueries({ queryKey: portalKeys.onboarding }),
      ])
      navigate("/", { replace: true })
    },
    onError: async (failure) => {
      const problem = toApiError(failure)
      if (
        problem instanceof ApiError &&
        problem.status === 409 &&
        problem.code === "agreement_version_changed"
      ) {
        setChecked(false)
        setNotice("The agreement was updated. Please read the new version.")
        await queryClient.invalidateQueries({ queryKey: portalKeys.agreement })
        return
      }
      setError(problem.message)
    },
  })

  if (agreement.isLoading) {
    return (
      <span
        role="status"
        aria-label="Loading"
        className="size-5 animate-spin rounded-full border-2 border-ui-border-strong border-t-ui-fg-base"
      />
    )
  }

  if (agreement.isError || !agreement.data) {
    return (
      <div className="flex flex-col items-start gap-y-2" role="alert">
        <Text className="text-ui-fg-error">{errorText(agreement.error)}</Text>
        <Button size="small" variant="secondary" onClick={() => void agreement.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const data = agreement.data

  return (
    <div className="flex flex-col gap-y-4" data-testid="screen-agreement">
      <Heading level="h1">Agreement</Heading>
      <Text className="text-ui-fg-subtle">
        Version {data.version}. Read both documents before you accept.
      </Text>

      {notice && <StatusBanner tone="warning">{notice}</StatusBanner>}

      {data.documents.map((document) => (
        <section key={document.key} className="flex flex-col gap-y-2">
          <Heading level="h2">{document.title}</Heading>
          <MarkdownDocument markdown={document.markdown} testId={docTestId(document.key)} />
        </section>
      ))}

      {data.accepted ? (
        <div data-testid="agreement-accepted">
          <StatusBanner tone="success">
            You accepted this version on{" "}
            {data.accepted_at ? new Date(data.accepted_at).toLocaleString() : "an earlier date"}.
          </StatusBanner>
        </div>
      ) : (
        <div className="flex flex-col gap-y-3 rounded-md bg-ui-bg-base p-4 shadow-elevation-card-rest">
          <div className="flex items-start gap-x-2">
            <Checkbox
              id="agreement-accept"
              data-testid="agreement-accept-checkbox"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <Label htmlFor="agreement-accept">
              I have read the agreement and the packing guideline and I accept both.
            </Label>
          </div>
          <div aria-live="polite">
            {error && (
              <Text size="small" className="text-ui-fg-error">
                {error}
              </Text>
            )}
          </div>
          <div>
            <Button
              disabled={!checked || accept.isPending}
              isLoading={accept.isPending}
              onClick={() => accept.mutate(data.version)}
              data-testid="agreement-accept-button"
            >
              Accept
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
