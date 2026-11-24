import { model } from "@medusajs/framework/utils";

// A pickup place of a vendor. `stock_location_id` is a plain column on
// purpose: a module link would make vendor data reachable through a Store API
// `fields` expansion.
const VendorLocation = model
  .define("vendor_location", {
    id: model.id({ prefix: "vloc" }).primaryKey(),
    vendor_id: model.text(),
    // Opaque code such as LOC-0042; the only name customers or couriers could ever see.
    code: model.text().unique(),
    // The vendor's own label, shown only to that vendor and to admin.
    label: model.text(),
    // ISO 3166-2:IN, for example IN-MH
    state_code: model.text(),
    pin: model.text(),
    address_1: model.text(),
    address_2: model.text().nullable(),
    city: model.text().nullable(),
    pickup_contact_name: model.text(),
    pickup_contact_phone: model.text(),
    status: model.enum(["active", "inactive"]).default("active"),
    stock_location_id: model.text().unique(),
  })
  .indexes([{ name: "IDX_vendor_location_vendor_id", on: ["vendor_id"] }]);

export default VendorLocation;
