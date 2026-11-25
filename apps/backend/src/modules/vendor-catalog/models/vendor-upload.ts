import { model } from "@medusajs/framework/utils";

// Records which vendor uploaded which file, so a vendor can attach only images
// it uploaded itself. `product_id` stays empty until the image is attached.
const VendorUpload = model
  .define("vendor_upload", {
    id: model.id({ prefix: "vupl" }).primaryKey(),
    vendor_id: model.text(),
    file_key: model.text().unique(),
    url: model.text(),
    product_id: model.text().nullable(),
  })
  .indexes([{ name: "IDX_vendor_upload_vendor_id", on: ["vendor_id"] }]);

export default VendorUpload;
