import { defineAllowlistSerializer } from "../define-allowlist-serializer";

// What a vendor may read about itself. The owner's private remarks, the
// reason for a suspension and every internal id stay out.
export const vendorSelfSerializer = defineAllowlistSerializer({
  name: "vendor-self",
  audience: "vendor",
  shape: {
    id: true,
    internal_name: true,
    contact_name: true,
    contact_email: true,
    status: true,
    activated_at: true,
    eligible_to_list: true,
  },
});

export const vendorUserSerializer = defineAllowlistSerializer({
  name: "vendor-user",
  audience: "vendor",
  shape: {
    id: true,
    email: true,
    name: true,
  },
});
