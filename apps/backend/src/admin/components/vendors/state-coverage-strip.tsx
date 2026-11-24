import { Container, Heading, Text } from "@medusajs/ui";
import type { CoverageEntry } from "../../lib/vendors-api";

type Props = {
  states: CoverageEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
};

const SINGLE_VENDOR_TEXT = "Only one active vendor serves this state.";

export const StateCoverageStrip = ({ states, isLoading, isError }: Props) => (
  <Container className="flex flex-col gap-y-3 px-6 py-4" data-testid="state-coverage">
    <Heading level="h2">States served</Heading>
    {isLoading && (
      <div
        role="status"
        aria-label="Loading states"
        className="h-6 w-1/2 animate-pulse rounded-md bg-ui-bg-component"
      />
    )}
    {isError && (
      <Text size="small" leading="compact" className="text-ui-fg-error">
        The state list could not be loaded.
      </Text>
    )}
    {!isLoading && !isError && states && states.length === 0 && (
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        No active vendors serve any state yet.
      </Text>
    )}
    {!isLoading && !isError && states && states.length > 0 && (
      <ul className="flex flex-wrap gap-2">
        {states.map((entry) => (
          <li
            key={entry.state_code}
            data-testid={`state-chip-${entry.state_code}`}
            data-single={entry.single_vendor ? "true" : "false"}
            title={entry.single_vendor ? SINGLE_VENDOR_TEXT : undefined}
            className={
              entry.single_vendor
                ? "rounded-md border border-ui-tag-orange-border bg-ui-tag-orange-bg px-2 py-1 text-ui-tag-orange-text"
                : "rounded-md border border-ui-border-base bg-ui-bg-component px-2 py-1 text-ui-fg-base"
            }
          >
            <Text size="small" leading="compact" weight="plus" className="text-inherit">
              {entry.state_name} ({entry.active_vendor_count})
            </Text>
            {entry.single_vendor && <span className="sr-only"> {SINGLE_VENDOR_TEXT}</span>}
          </li>
        ))}
      </ul>
    )}
  </Container>
);
