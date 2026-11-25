import { Badge, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"
import type { OnboardingStep } from "../lib/api"
import { isSafeRelativePath } from "../lib/safe-path"

// The agreement step has a built-in screen. Any other step brings its own path,
// which is shown as a link only when it is a plain relative portal path.
const targetFor = (step: OnboardingStep): string | null => {
  if (step.link == null) {
    return step.key === "agreement" ? "/agreement" : null
  }
  return isSafeRelativePath(step.link) ? step.link : null
}

export const OnboardingStepRow = ({ step }: { step: OnboardingStep }) => {
  const target = step.complete ? null : targetFor(step)
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-ui-bg-base p-3 shadow-elevation-card-rest"
      data-testid={`onboarding-step-${step.key}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Text weight="plus">{step.title}</Text>
        {step.required_for_activation && (
          <Badge size="2xsmall" color="grey">
            Required
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Badge size="2xsmall" color={step.complete ? "green" : "orange"}>
          {step.complete ? "Complete" : "Incomplete"}
        </Badge>
        {target && (
          <Link to={target} className="text-ui-fg-interactive txt-small-plus">
            Open
          </Link>
        )}
      </div>
    </li>
  )
}
