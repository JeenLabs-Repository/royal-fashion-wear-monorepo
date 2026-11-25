// Distinctive development data for the anonymity canary suite. Every text value
// carries a unique CNRY token so a leak can be traced to one field. The email
// domain is the reserved .invalid domain, so nothing here can reach a real inbox.
// This file holds data only and imports nothing.

export type CanaryVendorKey = "alpha" | "beta" | "gamma";

export type CanaryVendor = {
  key: CanaryVendorKey;
  status: "active" | "suspended";
  internal_name: string;
  contact_name: string;
  email: string;
  password: string;
  phone: string;
  note: string;
  suspend_reason: string;
  location: {
    label: string;
    address_1: string;
    address_2: string;
    city: string;
    state_code: string;
    pin: string;
    pickup_contact_name: string;
    pickup_contact_phone: string;
  };
};

export const CANARY_EMAIL_DOMAIN = "canary.invalid";

export const CANARY_VENDORS: Record<CanaryVendorKey, CanaryVendor> = {
  alpha: {
    key: "alpha",
    status: "active",
    internal_name: "CNRY-ALPHA-NAME-7QX3 Traders",
    contact_name: "CNRY-ALPHA-CONTACT-4KD8 Person",
    email: "cnry-alpha-7qx@canary.invalid",
    password: "Demo-Canary-Alpha-Passw0rd-2026",
    phone: "9990017001",
    note: "CNRY-ALPHA-NOTE-2MZ9 internal remark",
    suspend_reason: "CNRY-ALPHA-REASON-5HT1 unused",
    location: {
      label: "CNRY-ALPHA-LABEL-8RB2 Warehouse",
      address_1: "CNRY-ALPHA-STREET-3VN6 Road 14",
      address_2: "CNRY-ALPHA-LANDMARK-6WC4 Annex",
      city: "CNRY-ALPHA-CITY-9JF7pur",
      state_code: "IN-MH",
      pin: "400001",
      pickup_contact_name: "CNRY-ALPHA-PICKUP-1XA5 Desk",
      pickup_contact_phone: "9990017002",
    },
  },
  beta: {
    key: "beta",
    status: "active",
    internal_name: "CNRY-BETA-NAME-6PL2 Supplies",
    contact_name: "CNRY-BETA-CONTACT-8QE1 Person",
    email: "cnry-beta-3mk@canary.invalid",
    password: "Demo-Canary-Beta-Passw0rd-2026",
    phone: "9990017101",
    note: "CNRY-BETA-NOTE-4YU7 internal remark",
    suspend_reason: "CNRY-BETA-REASON-7DS3 unused",
    location: {
      label: "CNRY-BETA-LABEL-2NG9 Depot",
      address_1: "CNRY-BETA-STREET-5ZH4 Lane 9",
      address_2: "CNRY-BETA-LANDMARK-9AB6 Block",
      city: "CNRY-BETA-CITY-1TR8nagar",
      state_code: "IN-KA",
      pin: "560001",
      pickup_contact_name: "CNRY-BETA-PICKUP-3WK2 Desk",
      pickup_contact_phone: "9990017102",
    },
  },
  gamma: {
    key: "gamma",
    status: "suspended",
    internal_name: "CNRY-GAMMA-NAME-9CV5 Exports",
    contact_name: "CNRY-GAMMA-CONTACT-2LP6 Person",
    email: "cnry-gamma-8dz@canary.invalid",
    password: "Demo-Canary-Gamma-Passw0rd-2026",
    phone: "9990017201",
    note: "CNRY-GAMMA-NOTE-6FX1 internal remark",
    suspend_reason: "CNRY-GAMMA-REASON-4BM8 suspended by the canary seed",
    location: {
      label: "CNRY-GAMMA-LABEL-7HJ3 Yard",
      address_1: "CNRY-GAMMA-STREET-1RQ9 Marg 3",
      address_2: "CNRY-GAMMA-LANDMARK-5SE2 Wing",
      city: "CNRY-GAMMA-CITY-8UW4abad",
      state_code: "IN-DL",
      pin: "110001",
      pickup_contact_name: "CNRY-GAMMA-PICKUP-6KN7 Desk",
      pickup_contact_phone: "9990017202",
    },
  },
};

// Fake tax identifiers a later vendor compliance plugin could hold. They give
// the plugin route placeholder something distinctive to look for.
export const CANARY_PLUGIN = {
  pan: "CNRYP9999X",
  gstin: "29CNRYP9999X1Z5",
} as const;
