import { model } from "@medusajs/framework/utils";

// A person who signs in for a vendor. The email is stored in lower case (the
// service enforces it) and is unique across all vendors.
const VendorUser = model
  .define("vendor_user", {
    id: model.id({ prefix: "vusr" }).primaryKey(),
    vendor_id: model.text(),
    email: model.text().unique(),
    name: model.text(),
  })
  .indexes([{ name: "IDX_vendor_user_vendor_id", on: ["vendor_id"] }]);

export default VendorUser;
