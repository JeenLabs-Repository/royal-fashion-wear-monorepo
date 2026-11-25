import { model } from "@medusajs/framework/utils";

// Legal Metrology declaration fields, one row per product. All text is
// optional here; the approval step decides which are required for a category.
// Storage only: customer-facing display policy remains an owner or lawyer
// decision. Do not invent lawyer-approved declaration text.
const ProductDeclaration = model.define("product_declaration", {
  id: model.id({ prefix: "pdec" }).primaryKey(),
  product_id: model.text().unique(),
  vendor_id: model.text(),
  generic_name: model.text().nullable(),
  country_of_origin: model.text().nullable(),
  packed_by_name: model.text().nullable(),
  packed_by_address: model.text().nullable(),
});

export default ProductDeclaration;
