import { Button, Prompt, Text, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";

export const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText: string;
  isPending: boolean;
  serverError: string | null;
  onConfirm: (reason: string) => void;
};

export const ReasonPrompt = ({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  isPending,
  serverError,
  onConfirm,
}: Props) => {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setReason("");
    }
  }, [open]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_REASON_LENGTH && trimmed.length <= MAX_REASON_LENGTH;
  const showError = reason.length > 0 && trimmed.length < MIN_REASON_LENGTH;

  return (
    <Prompt open={open} onOpenChange={onOpenChange}>
      <Prompt.Content>
        <Prompt.Header>
          <Prompt.Title>{title}</Prompt.Title>
          <Prompt.Description>{description}</Prompt.Description>
        </Prompt.Header>
        <div className="flex flex-col gap-y-2 px-6 pb-4">
          <label htmlFor="vendor-reason" className="text-ui-fg-base txt-small-plus">
            Reason
          </label>
          <Textarea
            id="vendor-reason"
            data-testid="reason-input"
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex items-center justify-between">
            <Text size="small" leading="compact" className="text-ui-fg-error" aria-live="polite">
              {showError ? `Write at least ${MIN_REASON_LENGTH} characters.` : ""}
            </Text>
            <Text size="small" leading="compact" className="text-ui-fg-subtle">
              {trimmed.length} / {MIN_REASON_LENGTH} minimum
            </Text>
          </div>
          {serverError && (
            <Text size="small" leading="compact" className="text-ui-fg-error">
              {serverError}
            </Text>
          )}
        </div>
        <Prompt.Footer>
          <Prompt.Cancel disabled={isPending}>Cancel</Prompt.Cancel>
          {/* A plain button, not Prompt.Action, so the dialog stays open when the server refuses. */}
          <Button
            size="small"
            isLoading={isPending}
            disabled={!valid || isPending}
            onClick={() => onConfirm(trimmed)}
            data-testid="reason-confirm"
          >
            {confirmText}
          </Button>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  );
};
