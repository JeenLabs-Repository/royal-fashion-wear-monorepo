import { defineAllowlistSerializer } from "../define-allowlist-serializer";

export const vendorAgreementSerializer = defineAllowlistSerializer({
  name: "vendor-agreement",
  audience: "vendor",
  shape: {
    version: true,
    accepted: true,
    accepted_at: true,
    documents: {
      key: true,
      title: true,
      markdown: true,
    },
  },
});
