import { model } from "@medusajs/framework/utils";

// A vendor business as the owner knows it. The internal name, contact and note
// are returned only by admin and by the vendor's own serializers. No tax,
// payout or identity-document column belongs here.
const Vendor = model
  .define("vendor", {
    id: model.id({ prefix: "vnd" }).primaryKey(),
    internal_name: model.text(),
    contact_name: model.text(),
    contact_email: model.text(),
    status: model.enum(["invited", "active", "suspended"]).default("invited"),
    activated_at: model.dateTime().nullable(),
    suspended_at: model.dateTime().nullable(),
    suspend_reason: model.text().nullable(),
    // The owner's private note, never shown to the vendor.
    note: model.text().nullable(),
  })
  .indexes([{ name: "IDX_vendor_status", on: ["status"] }]);

export default Vendor;
