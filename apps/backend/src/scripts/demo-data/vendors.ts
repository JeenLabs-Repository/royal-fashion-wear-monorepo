// Demo vendors for development and browser specs. This file has no framework
// imports and holds no secret. The passwords are obviously fake development
// values that the seed script refuses to create in production.

export type DemoVendorKey = "alpha" | "bravo" | "charlie" | "delta" | "echo";

export type DemoLocation = {
  state_code: string;
  pin: string;
  status?: "active" | "inactive";
};

export type DemoVendor = {
  key: DemoVendorKey;
  internal_name: string;
  contact_name: string;
  email: string;
  password: string;
  /** The status the seed leaves the vendor in. */
  target_status: "invited" | "active" | "suspended";
  registered: boolean;
  agreement_accepted: boolean;
  locations: DemoLocation[];
  /** What this vendor is for, shown in the credentials file and the guide. */
  purpose: string;
};

export const DEMO_VENDOR_NAME_PREFIX = "Demo Vendor ";

export const DEMO_VENDORS: readonly DemoVendor[] = [
  {
    key: "alpha",
    internal_name: "Demo Vendor Alpha",
    contact_name: "Alpha Contact",
    email: "demo-vendor-alpha@example.test",
    password: "Demo-Alpha-Passw0rd-2026",
    target_status: "active",
    registered: true,
    agreement_accepted: true,
    locations: [
      { state_code: "IN-MH", pin: "400001" },
      { state_code: "IN-KA", pin: "560001" },
    ],
    purpose: "Active vendor with two locations. The everyday account for portal and API checks.",
  },
  {
    key: "bravo",
    internal_name: "Demo Vendor Bravo",
    contact_name: "Bravo Contact",
    email: "demo-vendor-bravo@example.test",
    password: "Demo-Bravo-Passw0rd-2026",
    target_status: "active",
    registered: true,
    agreement_accepted: true,
    locations: [{ state_code: "IN-DL", pin: "110001" }],
    purpose: "Second active vendor. Use it to check that one vendor never sees another.",
  },
  {
    key: "charlie",
    internal_name: "Demo Vendor Charlie",
    contact_name: "Charlie Contact",
    email: "demo-vendor-charlie@example.test",
    password: "Demo-Charlie-Passw0rd-2026",
    target_status: "invited",
    registered: true,
    agreement_accepted: false,
    locations: [{ state_code: "IN-TN", pin: "600001" }],
    purpose: "Registered but not active, agreement not accepted. Use it for the onboarding checklist.",
  },
  {
    key: "delta",
    internal_name: "Demo Vendor Delta",
    contact_name: "Delta Contact",
    email: "demo-vendor-delta@example.test",
    password: "Demo-Delta-Passw0rd-2026",
    target_status: "suspended",
    registered: true,
    agreement_accepted: true,
    locations: [{ state_code: "IN-GJ", pin: "380001" }],
    purpose: "Suspended vendor. Every request is refused with the suspension message.",
  },
  {
    key: "echo",
    internal_name: "Demo Vendor Echo",
    contact_name: "Echo Contact",
    email: "demo-vendor-echo@example.test",
    password: "Demo-Echo-Passw0rd-2026",
    target_status: "invited",
    registered: false,
    agreement_accepted: false,
    locations: [],
    purpose: "Invited, not registered. The seed writes its invitation link for the accept flow.",
  },
];

/** The extra invited vendors that the fresh invite option creates. */
export const FRESH_INVITE_NAME_PREFIX = "Demo Vendor Echo ";

export const freshInviteVendor = (number: number): DemoVendor => ({
  key: "echo",
  internal_name: `${FRESH_INVITE_NAME_PREFIX}${number}`,
  contact_name: `Echo Contact ${number}`,
  email: `demo-vendor-echo-${number}@example.test`,
  password: `Demo-Echo${number}-Passw0rd-2026`,
  target_status: "invited",
  registered: false,
  agreement_accepted: false,
  locations: [],
  purpose: "A fresh invitation for the accept flow.",
});

// Template for the fresh vendors created on demand for browser specs. The email,
// the name and the password get a unique suffix per vendor.
export const FRESH_VENDOR_TEMPLATE = {
  name_prefix: "Demo Vendor Fresh",
  email_prefix: "demo-vendor-fresh",
  contact_name: "Demo Fresh Contact",
  password_prefix: "Demo-Fresh-Passw0rd",
  locations: [
    {
      label: "Fresh Warehouse Mumbai",
      address_1: "1 Fresh Street",
      city: "Mumbai",
      state_code: "IN-MH",
      pin: "400001",
      pickup_contact_name: "Fresh Desk One",
      pickup_contact_phone: "9990050001",
    },
    {
      label: "Fresh Warehouse Bengaluru",
      address_1: "2 Fresh Street",
      city: "Bengaluru",
      state_code: "IN-KA",
      pin: "560001",
      pickup_contact_name: "Fresh Desk Two",
      pickup_contact_phone: "9990050002",
    },
  ],
} as const;
