import { Badge, Container, Heading, Text } from "@medusajs/ui";
import type { OnboardingStep } from "../../lib/vendors-api";

export const OnboardingStepsCard = ({ steps }: { steps: OnboardingStep[] }) => (
  <Container className="flex flex-col gap-y-3 px-6 py-4" data-testid="onboarding-steps">
    <Heading level="h2">Onboarding steps</Heading>
    {steps.length === 0 ? (
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        There are no onboarding steps.
      </Text>
    ) : (
      <ul className="flex flex-col gap-y-2">
        {steps.map((step) => (
          <li
            key={step.key}
            data-testid={`onboarding-step-${step.key}`}
            className="flex items-center justify-between gap-x-3"
          >
            <div className="flex items-center gap-x-2">
              <Text size="small" leading="compact" weight="plus">
                {step.title}
              </Text>
              {step.required_for_activation && (
                <Badge size="2xsmall" color="grey">
                  Required
                </Badge>
              )}
            </div>
            <Badge size="2xsmall" color={step.complete ? "green" : "orange"}>
              {step.complete ? "Complete" : "Incomplete"}
            </Badge>
          </li>
        ))}
      </ul>
    )}
  </Container>
);
