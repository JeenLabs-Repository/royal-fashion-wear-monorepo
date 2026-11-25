import { model } from "@medusajs/framework/utils";

// One row per product a vendor submitted. Plain id columns only: no link to the
// product, vendor or category modules, so vendor data cannot be reached through
// a `fields=` expansion on a commerce model.
const ProductSubmission = model
  .define("product_submission", {
    id: model.id({ prefix: "psub" }).primaryKey(),
    product_id: model.text().unique(),
    vendor_id: model.text(),
    state: model
      .enum(["draft", "submitted", "approved", "changes_requested", "rejected", "withdrawn"])
      .default("draft"),
    is_live: model.boolean().default(false),
    revision: model.number().default(1),
    content_hash: model.text(),
    approved_content_hash: model.text().nullable(),
    pending_changes: model.json().nullable(),
    proposed_category_id: model.text().nullable(),
    proposed_gst_class: model
      .enum(["GST-0", "GST-5", "GST-18", "GST-40", "not_sure"])
      .default("not_sure"),
    proposed_hsn: model.text().nullable(),
    reviewer_user_id: model.text().nullable(),
    reason: model.text().nullable(),
    approver_edits: model.json().nullable(),
    submitted_at: model.dateTime().nullable(),
    decided_at: model.dateTime().nullable(),
    hidden_by_suspension: model.boolean().default(false),
  })
  .indexes([
    { name: "IDX_product_submission_vendor_id", on: ["vendor_id"] },
    { name: "IDX_product_submission_state_submitted_at", on: ["state", "submitted_at"] },
  ]);

export default ProductSubmission;
