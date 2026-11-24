import { model } from "@medusajs/framework/utils";

// Only the SHA-256 of the token is stored. `used_at` set means the invitation
// was used to register; an earlier invitation is retired by moving its expiry.
const VendorInvite = model
  .define("vendor_invite", {
    id: model.id({ prefix: "vinv" }).primaryKey(),
    vendor_user_id: model.text(),
    token_hash: model.text().unique(),
    expires_at: model.dateTime(),
    used_at: model.dateTime().nullable(),
  })
  .indexes([{ name: "IDX_vendor_invite_vendor_user_id", on: ["vendor_user_id"] }]);

export default VendorInvite;
