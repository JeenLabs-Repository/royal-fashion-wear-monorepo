import { model } from "@medusajs/framework/utils";

const VendorAgreementAcceptance = model
  .define("vendor_agreement_acceptance", {
    id: model.id({ prefix: "vagr" }).primaryKey(),
    vendor_user_id: model.text(),
    version: model.text(),
    accepted_at: model.dateTime(),
    ip: model.text().nullable(),
    user_agent: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_vendor_agreement_acceptance_vendor_user_id",
      on: ["vendor_user_id"],
    },
  ]);

export default VendorAgreementAcceptance;
