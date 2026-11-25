import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { contentHash } from "../../lib/catalog/content-snapshot";
import { loadLiveSnapshotByProduct } from "../../lib/catalog/load-content";
import {
  assertTransitionStep,
  loadOwnedSubmissionStep,
  transitionSubmissionStep,
} from "../steps/catalog/transition-submission";
import {
  pendingOnlyUploadsStep,
  releaseUploadsStep,
} from "../steps/catalog/validate-content-refs";

export type VendorDiscardPendingInput = { vendor_id: string; product_id: string };

const liveHashStep = createStep(
  "live-content-hash",
  async (input: { product_id: string }, { container }) =>
    new StepResponse({
      content_hash: contentHash(await loadLiveSnapshotByProduct(container, input.product_id)),
    })
);

/**
 * Drops the pending revision of a live product. The product returns to approved, the hash goes
 * back to the live content and the uploads that only the pending revision used are freed.
 */
export const vendorDiscardPendingWorkflow = createWorkflow(
  "vendor-discard-pending",
  function (input: VendorDiscardPendingInput) {
    const loaded = loadOwnedSubmissionStep({
      vendor_id: input.vendor_id,
      product_id: input.product_id,
    });
    assertTransitionStep({ submission_id: loaded.submission_id, event: "discard_pending" });
    const pendingOnly = pendingOnlyUploadsStep({ product_id: input.product_id });
    const liveHash = liveHashStep({ product_id: input.product_id });
    const transitioned = transitionSubmissionStep({
      submission_id: loaded.submission_id,
      vendor_id: input.vendor_id,
      event: "discard_pending",
      content_hash: liveHash.content_hash,
      bump_revision: true,
    });
    releaseUploadsStep({ upload_ids: pendingOnly.upload_ids });
    return new WorkflowResponse(transitioned);
  }
);
