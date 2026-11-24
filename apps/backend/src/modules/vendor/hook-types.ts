// Payload types for the three plugin hooks. Types only, so a plugin can import
// them without pulling in any framework code.

export type VendorActivatingPayload = {
  vendor_id: string;
  trigger: "activation" | "reactivation";
};

export type VendorSuspendedPayload = {
  vendor_id: string;
  reason: string;
};

export type VendorLocationValidatingPayload = {
  vendor_id: string;
  operation: "create" | "update";
  location_id?: string;
  proposed: {
    label: string;
    state_code: string;
    pin: string;
    address_1: string;
    address_2?: string | null;
    city?: string | null;
    pickup_contact_name: string;
    pickup_contact_phone: string;
    status: "active" | "inactive";
  };
};
