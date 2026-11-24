import { Button, Container, Text } from "@medusajs/ui";

export const LoadingState = ({ label = "Loading" }: { label?: string }) => (
  <Container className="flex items-center gap-x-3 px-6 py-4">
    <span
      role="status"
      aria-label={label}
      className="size-4 animate-spin rounded-full border-2 border-ui-border-strong border-t-ui-fg-base"
    />
    <Text size="small" leading="compact" className="text-ui-fg-subtle">
      {label}
    </Text>
  </Container>
);

export const EmptyState = ({ message }: { message: string }) => (
  <Container className="px-6 py-4">
    <Text size="small" leading="compact" className="text-ui-fg-subtle">
      {message}
    </Text>
  </Container>
);

export const ErrorState = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) => (
  <Container className="flex items-center justify-between gap-x-3 px-6 py-4">
    <Text size="small" leading="compact" className="text-ui-fg-error">
      {message}
    </Text>
    <Button size="small" variant="secondary" onClick={onRetry}>
      Retry
    </Button>
  </Container>
);

export const NoAccessState = ({ message }: { message: string }) => (
  <Container className="flex flex-col gap-y-1 px-6 py-4">
    <Text size="small" leading="compact" weight="plus">
      {message}
    </Text>
    <Text size="small" leading="compact" className="text-ui-fg-subtle">
      If you have not set up two-step sign-in yet, do that under Profile &gt; Security first.
    </Text>
  </Container>
);
