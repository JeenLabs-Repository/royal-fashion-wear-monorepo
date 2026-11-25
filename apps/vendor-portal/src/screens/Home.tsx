import { Button, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { OnboardingStepRow } from "../components/OnboardingStepRow"
import { StatusBanner } from "../components/StatusBanner"
import { type Onboarding, getOnboarding, portalKeys } from "../lib/api"
import { errorText } from "../lib/errors"

const bannerFor = (onboarding: Onboarding) => {
  const requiredOpen = onboarding.steps.some(
    (step) => step.required_for_activation && !step.complete
  )
  const agreementOpen = onboarding.steps.some(
    (step) => step.key === "agreement" && !step.complete
  )

  if (onboarding.status === "invited") {
    return onboarding.activation_pending ? (
      <StatusBanner tone="info">
        Everything is done on your side. The store team will activate your account.
      </StatusBanner>
    ) : (
      <StatusBanner tone="info">
        Complete the steps below. The store activates your account after they are done.
      </StatusBanner>
    )
  }

  if (agreementOpen) {
    return (
      <StatusBanner tone="warning">
        The agreement was updated.{" "}
        <Link to="/agreement" className="underline">
          Read and accept it
        </Link>{" "}
        to keep listing products.
      </StatusBanner>
    )
  }
  if (requiredOpen) {
    return (
      <StatusBanner tone="warning">A required step is still open. Complete it below.</StatusBanner>
    )
  }
  return <StatusBanner tone="success">Your account is active.</StatusBanner>
}

export const Home = () => {
  const onboarding = useQuery({
    queryKey: portalKeys.onboarding,
    queryFn: getOnboarding,
    retry: false,
  })

  return (
    <div className="flex flex-col gap-y-4" data-testid="screen-home">
      <Heading level="h1">Home</Heading>

      {onboarding.isLoading && (
        <span
          role="status"
          aria-label="Loading"
          className="size-5 animate-spin rounded-full border-2 border-ui-border-strong border-t-ui-fg-base"
        />
      )}

      {onboarding.isError && (
        <div className="flex flex-col items-start gap-y-2" role="alert">
          <Text className="text-ui-fg-error">{errorText(onboarding.error)}</Text>
          <Button size="small" variant="secondary" onClick={() => void onboarding.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {onboarding.data && (
        <>
          {bannerFor(onboarding.data)}
          <section className="flex flex-col gap-y-2" aria-labelledby="steps-heading">
            <Heading level="h2" id="steps-heading">
              Your steps
            </Heading>
            <ul className="flex flex-col gap-y-2" data-testid="onboarding-list">
              {onboarding.data.steps.map((step) => (
                <OnboardingStepRow key={step.key} step={step} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
