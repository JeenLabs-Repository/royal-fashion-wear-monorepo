import { model } from "@medusajs/framework/utils";

// Money is stored in decimal rupees through bigNumber, never in paise.
// The vendor SKU is unique per vendor only, so a clash never reveals another
// vendor's SKU. The index is soft-delete aware: Medusa adds the condition
// `deleted_at IS NULL` to every unique index, so a deleted variant frees its SKU.
const VendorVariantRef = model
  .define("vendor_variant_ref", {
    id: model.id({ prefix: "vvr" }).primaryKey(),
    variant_id: model.text().unique(),
    product_id: model.text(),
    vendor_id: model.text(),
    vendor_sku: model.text(),
    payout_price: model.bigNumber(),
    mrp: model.bigNumber().nullable(),
    net_quantity_value: model.float().nullable(),
    net_quantity_unit: model.enum(["g", "kg", "ml", "l", "pcs"]).nullable(),
  })
  .indexes([
    { name: "IDX_vendor_variant_ref_product_id", on: ["product_id"] },
    { name: "IDX_vendor_variant_ref_vendor_id", on: ["vendor_id"] },
    {
      name: "IDX_vendor_variant_ref_vendor_sku_unique",
      on: ["vendor_id", "vendor_sku"],
      unique: true,
    },
  ]);

export default VendorVariantRef;
