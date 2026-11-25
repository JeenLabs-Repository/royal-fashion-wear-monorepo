import { model } from "@medusajs/framework/utils";

// Named counters. The platform SKU number is the row with id and name
// "platform_sku". The id is plain text so the increment can upsert on the
// primary key, which a soft-delete-aware unique index cannot be used for.
const CatalogCounter = model.define("catalog_counter", {
  id: model.text().primaryKey(),
  name: model.text().unique(),
  value: model.number().default(0),
});

export default CatalogCounter;
