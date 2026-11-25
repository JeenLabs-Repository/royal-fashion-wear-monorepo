import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import type { ContentSnapshot } from "../../lib/catalog/content-snapshot";
import { createDraftProductStep } from "../steps/catalog/create-draft-product";
import { createSubmissionStep } from "../steps/catalog/create-submission";
import {
  assertVendorEligibleStep,
  validateContentRefsStep,
} from "../steps/catalog/validate-content-refs";

export type VendorCreateProductInput = {
  vendor_id: string;
  content: ContentSnapshot;
};

// Order matters: eligibility first, then every reference is checked before anything is
// written, then the core draft, then the vendor-owned rows. A failure at any step
// compensates the earlier ones.
export const vendorCreateProductWorkflow = createWorkflow(
  "vendor-create-product",
  (input: VendorCreateProductInput) => {
    assertVendorEligibleStep({ vendor_id: input.vendor_id });
    const imageUrls = validateContentRefsStep({
      vendor_id: input.vendor_id,
      content: input.content,
    });
    const draft = createDraftProductStep({ content: input.content, image_urls: imageUrls });
    const submission = createSubmissionStep({
      vendor_id: input.vendor_id,
      content: input.content,
      product: draft,
    });
    return new WorkflowResponse(submission);
  }
);
