import {
  Button,
  Drawer,
  FocusModal,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { STATE_OPTIONS } from "../../lib/india-states";
import {
  type LocationBody,
  type VendorLocation,
  createLocation,
  errorMessage,
  updateLocation,
  vendorKeys,
} from "../../lib/vendors-api";

const PIN_PATTERN = /^[1-9][0-9]{5}$/;
const PHONE_PATTERN = /^\+?[0-9]{8,13}$/;

type FormState = {
  label: string;
  state_code: string;
  pin: string;
  address_1: string;
  address_2: string;
  city: string;
  pickup_contact_name: string;
  pickup_contact_phone: string;
  status: "active" | "inactive";
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const EMPTY: FormState = {
  label: "",
  state_code: "",
  pin: "",
  address_1: "",
  address_2: "",
  city: "",
  pickup_contact_name: "",
  pickup_contact_phone: "",
  status: "active",
};

const fromLocation = (location: VendorLocation): FormState => ({
  label: location.label,
  state_code: location.state_code,
  pin: location.pin,
  address_1: location.address_1,
  address_2: location.address_2 ?? "",
  city: location.city ?? "",
  pickup_contact_name: location.pickup_contact_name,
  pickup_contact_phone: location.pickup_contact_phone,
  status: location.status,
});

// The same limits the API enforces. The server stays the authority and its
// messages (including the PIN and state mismatch) are shown inline.
export const validateLocation = (form: FormState): FormErrors => {
  const errors: FormErrors = {};
  const label = form.label.trim();
  if (label.length < 1 || label.length > 60) errors.label = "Enter a label of up to 60 characters.";
  if (!form.state_code) errors.state_code = "Choose a state.";
  if (!PIN_PATTERN.test(form.pin.trim())) errors.pin = "Enter a 6-digit PIN that does not start with 0.";
  const address = form.address_1.trim();
  if (address.length < 1 || address.length > 120) errors.address_1 = "Enter an address line of up to 120 characters.";
  if (form.address_2.length > 120) errors.address_2 = "Use up to 120 characters.";
  if (form.city.length > 120) errors.city = "Use up to 120 characters.";
  const contact = form.pickup_contact_name.trim();
  if (contact.length < 1 || contact.length > 80) errors.pickup_contact_name = "Enter a name of up to 80 characters.";
  if (!PHONE_PATTERN.test(form.pickup_contact_phone.replace(/[\s-]/g, ""))) {
    errors.pickup_contact_phone = "Enter a phone number of 8 to 13 digits.";
  }
  return errors;
};

const toBody = (form: FormState, includeStatus: boolean): LocationBody => ({
  label: form.label.trim(),
  state_code: form.state_code,
  pin: form.pin.trim(),
  address_1: form.address_1.trim(),
  ...(form.address_2.trim() ? { address_2: form.address_2.trim() } : {}),
  ...(form.city.trim() ? { city: form.city.trim() } : {}),
  pickup_contact_name: form.pickup_contact_name.trim(),
  pickup_contact_phone: form.pickup_contact_phone.replace(/[\s-]/g, ""),
  ...(includeStatus ? { status: form.status } : {}),
});

type FieldsProps = {
  form: FormState;
  errors: FormErrors;
  serverError: string | null;
  showStatus: boolean;
  code?: string;
  onChange: (key: keyof FormState, value: string) => void;
};

const Field = ({ label, id, error, children }: { label: string; id: string; error?: string; children: ReactNode }) => (
  <div className="flex flex-col gap-y-1">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {error && (
      <Text size="small" className="text-ui-fg-error">
        {error}
      </Text>
    )}
  </div>
);

const LocationFields = ({ form, errors, serverError, showStatus, code, onChange }: FieldsProps) => (
  <div className="flex flex-col gap-y-4" data-testid="location-form">
    {code && (
      <div className="flex flex-col gap-y-1">
        <Label>Code</Label>
        <Text size="small" leading="compact" weight="plus" data-testid="location-code">
          {code}
        </Text>
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          Location codes are assigned automatically and cannot change.
        </Text>
      </div>
    )}
    <Field label="Label" id="location-label" error={errors.label}>
      <Input id="location-label" data-testid="location-label" value={form.label} onChange={(e) => onChange("label", e.target.value)} />
    </Field>
    <Field label="Address line 1" id="location-address-1" error={errors.address_1}>
      <Input id="location-address-1" data-testid="location-address-1" value={form.address_1} onChange={(e) => onChange("address_1", e.target.value)} />
    </Field>
    <Field label="Address line 2" id="location-address-2" error={errors.address_2}>
      <Input id="location-address-2" value={form.address_2} onChange={(e) => onChange("address_2", e.target.value)} />
    </Field>
    <Field label="City" id="location-city" error={errors.city}>
      <Input id="location-city" value={form.city} onChange={(e) => onChange("city", e.target.value)} />
    </Field>
    <Field label="State" id="location-state" error={errors.state_code}>
      <Select value={form.state_code} onValueChange={(value) => onChange("state_code", value)}>
        <Select.Trigger id="location-state" data-testid="location-state">
          <Select.Value placeholder="Choose a state" />
        </Select.Trigger>
        <Select.Content>
          {STATE_OPTIONS.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select>
    </Field>
    <Field label="PIN" id="location-pin" error={errors.pin}>
      <Input id="location-pin" data-testid="location-pin" inputMode="numeric" maxLength={6} value={form.pin} onChange={(e) => onChange("pin", e.target.value)} />
    </Field>
    <Field label="Pickup contact name" id="location-contact-name" error={errors.pickup_contact_name}>
      <Input id="location-contact-name" data-testid="location-contact-name" value={form.pickup_contact_name} onChange={(e) => onChange("pickup_contact_name", e.target.value)} />
    </Field>
    <Field label="Pickup contact phone" id="location-contact-phone" error={errors.pickup_contact_phone}>
      <Input id="location-contact-phone" data-testid="location-contact-phone" value={form.pickup_contact_phone} onChange={(e) => onChange("pickup_contact_phone", e.target.value)} />
    </Field>
    {showStatus && (
      <Field label="Status" id="location-status">
        <Select value={form.status} onValueChange={(value) => onChange("status", value)}>
          <Select.Trigger id="location-status" data-testid="location-status">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="active">Active</Select.Item>
            <Select.Item value="inactive">Inactive</Select.Item>
          </Select.Content>
        </Select>
      </Field>
    )}
    {serverError && (
      <Text size="small" className="text-ui-fg-error" data-testid="location-server-error">
        {serverError}
      </Text>
    )}
  </div>
);

const useLocationForm = (initial: FormState, resetKey: string | boolean) => {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    setForm(initial);
    setErrors({});
    setServerError(null);
    // The form resets when the dialog opens or another location is chosen.
    // initial is omitted on purpose: callers pass a fresh object each render.
  }, [resetKey]);

  const change = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  return { form, errors, setErrors, serverError, setServerError, change };
};

type CreateProps = { vendorId: string; open: boolean; onOpenChange: (open: boolean) => void };

// Creating uses a focus modal.
export const LocationCreateModal = ({ vendorId, open, onOpenChange }: CreateProps) => {
  const queryClient = useQueryClient();
  const { form, errors, setErrors, serverError, setServerError, change } = useLocationForm(EMPTY, open);

  const create = useMutation({
    mutationFn: (body: LocationBody) => createLocation(vendorId, body),
    onSuccess: async (result) => {
      toast.success(`Location ${result.location.code} created`);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: vendorKeys.detail(vendorId) });
      await queryClient.invalidateQueries({ queryKey: vendorKeys.coverage });
    },
    onError: (error) => setServerError(errorMessage(error)),
  });

  const submit = () => {
    const found = validateLocation(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length === 0) {
      create.mutate(toBody(form, false));
    }
  };

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <div className="flex h-full flex-col overflow-hidden">
          <FocusModal.Header>
            <FocusModal.Title className="sr-only">Add location</FocusModal.Title>
            <FocusModal.Description className="sr-only">
              The code is assigned automatically.
            </FocusModal.Description>
            <div className="flex items-center justify-end gap-x-2">
              <FocusModal.Close asChild>
                <Button size="small" variant="secondary" disabled={create.isPending}>
                  Cancel
                </Button>
              </FocusModal.Close>
              <Button size="small" isLoading={create.isPending} disabled={create.isPending} onClick={submit} data-testid="location-submit">
                Save location
              </Button>
            </div>
          </FocusModal.Header>
          <FocusModal.Body className="flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-lg py-8">
              <LocationFields form={form} errors={errors} serverError={serverError} showStatus={false} onChange={change} />
            </div>
          </FocusModal.Body>
        </div>
      </FocusModal.Content>
    </FocusModal>
  );
};

type EditProps = {
  vendorId: string;
  location: VendorLocation | null;
  onOpenChange: (open: boolean) => void;
};

// Editing uses a drawer.
export const LocationEditDrawer = ({ vendorId, location, onOpenChange }: EditProps) => {
  const queryClient = useQueryClient();
  const initial = location ? fromLocation(location) : EMPTY;
  const { form, errors, setErrors, serverError, setServerError, change } = useLocationForm(initial, location?.id ?? "none");

  const update = useMutation({
    mutationFn: (input: { locationId: string; body: LocationBody }) =>
      updateLocation(vendorId, input.locationId, input.body),
    onSuccess: async (result) => {
      toast.success(`Location ${result.location.code} updated`);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: vendorKeys.detail(vendorId) });
      await queryClient.invalidateQueries({ queryKey: vendorKeys.coverage });
    },
    onError: (error) => setServerError(errorMessage(error)),
  });

  const submit = () => {
    if (!location) return;
    const found = validateLocation(form);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length === 0) {
      update.mutate({ locationId: location.id, body: toBody(form, true) });
    }
  };

  return (
    <Drawer open={location !== null} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit location</Drawer.Title>
          <Drawer.Description>{location?.code}</Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex-1 overflow-auto p-4">
          {location && (
            <LocationFields
              form={form}
              errors={errors}
              serverError={serverError}
              showStatus
              code={location.code}
              onChange={change}
            />
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <Drawer.Close asChild>
              <Button size="small" variant="secondary" disabled={update.isPending}>
                Cancel
              </Button>
            </Drawer.Close>
            <Button size="small" isLoading={update.isPending} disabled={update.isPending} onClick={submit} data-testid="location-submit">
              Save changes
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  );
};
