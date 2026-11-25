import { Button, Drawer, Label, Text, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";

export const MIN_REASON = 10;
export const MAX_REASON = 1000;

type ReasonDialogProps = {
  open: boolean;
  title: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export const ReasonDialog = ({
  open,
  title,
  confirmLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: ReasonDialogProps) => {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);

  const length = reason.trim().length;
  const valid = length >= MIN_REASON && reason.length <= MAX_REASON;

  return (
    <Drawer open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
          <Drawer.Description>The vendor will see this reason.</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-2">
          <Label htmlFor="review-reason">Reason</Label>
          <Textarea
            id="review-reason"
            data-testid="reason-input"
            value={reason}
            maxLength={MAX_REASON}
            rows={6}
            onChange={(event) => setReason(event.target.value)}
          />
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            {length} of {MIN_REASON} characters at least, {MAX_REASON} at most
          </Text>
          {error ? (
            <Text size="small" leading="compact" className="text-ui-fg-error" role="alert">
              {error}
            </Text>
          ) : null}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            data-testid="reason-confirm"
            disabled={!valid}
            isLoading={pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  );
};
