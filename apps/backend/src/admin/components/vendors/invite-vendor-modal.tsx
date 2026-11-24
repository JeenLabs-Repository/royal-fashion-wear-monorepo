import { Button, FocusModal, Input, Label, Text, Textarea, toast } from "@medusajs/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type InviteBody, errorMessage, inviteVendor, vendorKeys } from "../../lib/vendors-api";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

type FieldErrors = Partial<Record<"internal_name" | "contact_name" | "contact_email" | "note", string>>;

const EMPTY = { internal_name: "", contact_name: "", contact_email: "", note: "" };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The same limits the API enforces. The server stays the authority.
export const validateInvite = (form: typeof EMPTY): FieldErrors => {
  const errors: FieldErrors = {};
  const internal = form.internal_name.trim();
  const contact = form.contact_name.trim();
  if (internal.length < 1 || internal.length > 150) {
    errors.internal_name = "Enter an internal name of up to 150 characters.";
  }
  if (contact.length < 1 || contact.length > 100) {
    errors.contact_name = "Enter a contact name of up to 100 characters.";
  }
  if (!EMAIL_PATTERN.test(form.contact_email.trim())) {
    errors.contact_email = "Enter a valid email address.";
  }
  if (form.note.length > 1000) {
    errors.note = "The note can hold up to 1000 characters.";
  }
  return errors;
};

export const InviteVendorModal = ({ open, onOpenChange }: Props) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: (body: InviteBody) => inviteVendor(body),
    onSuccess: async (result, body) => {
      if (result.invite.email_sent) {
        toast.success(`Invitation sent to ${body.contact_email}`);
      } else {
        toast.warning("Vendor created, but the email could not be sent. Use Resend invite.");
      }
      setForm(EMPTY);
      setErrors({});
      setServerError(null);
      onOpenChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: vendorKeys.all }),
      ]);
    },
    onError: (error) => setServerError(errorMessage(error)),
  });

  const submit = () => {
    const found = validateInvite(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) {
      return;
    }
    const note = form.note.trim();
    invite.mutate({
      internal_name: form.internal_name.trim(),
      contact_name: form.contact_name.trim(),
      contact_email: form.contact_email.trim(),
      ...(note ? { note } : {}),
    });
  };

  const set = (key: keyof typeof EMPTY, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <div className="flex h-full flex-col overflow-hidden" data-testid="invite-vendor-form">
          <FocusModal.Header>
            <FocusModal.Title className="sr-only">Invite vendor</FocusModal.Title>
            <FocusModal.Description className="sr-only">
              Send an invitation by email. The vendor sets a password from the link.
            </FocusModal.Description>
            <div className="flex items-center justify-end gap-x-2">
              <FocusModal.Close asChild>
                <Button size="small" variant="secondary" disabled={invite.isPending}>
                  Cancel
                </Button>
              </FocusModal.Close>
              <Button
                size="small"
                isLoading={invite.isPending}
                disabled={invite.isPending}
                onClick={submit}
                data-testid="invite-vendor-submit"
              >
                Send invitation
              </Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex-1 overflow-auto">
            <div className="mx-auto flex w-full max-w-lg flex-col gap-y-4 py-8">
              <div className="flex flex-col gap-y-1">
                <Label htmlFor="invite-internal-name">Internal name</Label>
                <Input
                  id="invite-internal-name"
                  data-testid="invite-internal-name"
                  value={form.internal_name}
                  onChange={(event) => set("internal_name", event.target.value)}
                />
                {errors.internal_name && (
                  <Text size="small" className="text-ui-fg-error">
                    {errors.internal_name}
                  </Text>
                )}
              </div>
              <div className="flex flex-col gap-y-1">
                <Label htmlFor="invite-contact-name">Contact name</Label>
                <Input
                  id="invite-contact-name"
                  data-testid="invite-contact-name"
                  value={form.contact_name}
                  onChange={(event) => set("contact_name", event.target.value)}
                />
                {errors.contact_name && (
                  <Text size="small" className="text-ui-fg-error">
                    {errors.contact_name}
                  </Text>
                )}
              </div>
              <div className="flex flex-col gap-y-1">
                <Label htmlFor="invite-contact-email">Contact email</Label>
                <Input
                  id="invite-contact-email"
                  type="email"
                  data-testid="invite-contact-email"
                  value={form.contact_email}
                  onChange={(event) => set("contact_email", event.target.value)}
                />
                {errors.contact_email && (
                  <Text size="small" className="text-ui-fg-error">
                    {errors.contact_email}
                  </Text>
                )}
              </div>
              <div className="flex flex-col gap-y-1">
                <Label htmlFor="invite-note">Internal note (optional, never shown to the vendor)</Label>
                <Textarea
                  id="invite-note"
                  data-testid="invite-note"
                  value={form.note}
                  onChange={(event) => set("note", event.target.value)}
                />
                {errors.note && (
                  <Text size="small" className="text-ui-fg-error">
                    {errors.note}
                  </Text>
                )}
              </div>
              {serverError && (
                <Text size="small" className="text-ui-fg-error" data-testid="invite-server-error">
                  {serverError}
                </Text>
              )}
            </div>
          </FocusModal.Body>
        </div>
      </FocusModal.Content>
    </FocusModal>
  );
};
