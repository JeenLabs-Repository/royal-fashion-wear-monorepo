import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { deleteFilesWorkflow } from "@medusajs/medusa/core-flows";
import { recordAudit } from "../../lib/audit";
import { storeProcessedImage } from "../../lib/images/store-image";
import { assertVendorEligible } from "../../lib/vendor/eligibility";
import { assertUploadCapacityStep, recordUploadStep } from "../steps/catalog/record-upload";

export type VendorRecordUploadInput = {
  vendor_id: string;
  vendor_user_id: string;
  vendor_label?: string;
  /** The processed WebP bytes as base64, so the input stays plain data */
  image_base64: string;
};

const assertEligibleStep = createStep(
  "assert-vendor-eligible-for-upload",
  async (input: { vendor_id: string }, { container }) => {
    await assertVendorEligible(container, input.vendor_id);
    return new StepResponse({ eligible: true });
  }
);

// The stored file is removed again when a later step fails.
const storeImageStep = createStep(
  "store-vendor-upload-image",
  async (input: { image_base64: string }, { container }) => {
    const stored = await storeProcessedImage(container, Buffer.from(input.image_base64, "base64"));
    return new StepResponse(stored, stored.id);
  },
  async (fileId, { container }) => {
    if (fileId) {
      await deleteFilesWorkflow(container).run({ input: { ids: [fileId] } });
    }
  }
);

// Last step: a written audit row is never removed. The entry names the upload
// and the actor, and never a file name.
const auditUploadStep = createStep(
  "audit-vendor-upload",
  async (
    input: { upload_id: string; vendor_user_id: string; vendor_label?: string },
    { container }
  ) => {
    await recordAudit(container, {
      action: "upload.created",
      actor: { type: "vendor", id: input.vendor_user_id, label: input.vendor_label },
      target: { type: "upload", id: input.upload_id },
    });
    return new StepResponse({ recorded: true });
  }
);

export const vendorRecordUploadWorkflow = createWorkflow(
  "vendor-record-upload",
  function (input: VendorRecordUploadInput) {
    assertEligibleStep({ vendor_id: input.vendor_id });
    assertUploadCapacityStep({ vendor_id: input.vendor_id });
    const stored = storeImageStep({ image_base64: input.image_base64 });
    const upload = recordUploadStep(
      transform({ input, stored }, (data) => ({
        vendor_id: data.input.vendor_id,
        file_id: data.stored.id,
        url: data.stored.url,
      }))
    );
    auditUploadStep(
      transform({ input, upload }, (data) => ({
        upload_id: data.upload.id,
        vendor_user_id: data.input.vendor_user_id,
        vendor_label: data.input.vendor_label,
      }))
    );
    return new WorkflowResponse(upload);
  }
);
