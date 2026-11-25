import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { emitEventStep } from "@medusajs/medusa/core-flows";
import { applyContentToProduct } from "../../lib/catalog/apply-content";
import { contentHash, type ContentSnapshot } from "../../lib/catalog/content-snapshot";
import { catalogError } from "../../lib/catalog/errors";
import {
  comparableHash,
  loadLiveSnapshotByProduct,
  readCoreProduct,
  withLiveVariantIds,
} from "../../lib/catalog/load-content";
import type { SubmissionEvent } from "../../lib/catalog/state-machine";
import { checkVariantRemovalStep } from "../steps/catalog/check-variant-removal";
import {
  assertTransitionStep,
  loadOwnedSubmissionStep,
  transitionSubmissionStep,
} from "../steps/catalog/transition-submission";
import {
  assertVendorEligibleStep,
  attachUploadsStep,
  validateContentRefsStep,
} from "../steps/catalog/validate-content-refs";

export type VendorUpdateProductInput = {
  vendor_id: string;
  product_id: string;
  content: ContentSnapshot;
};

type PrepareInput = { product_id: string; content: ContentSnapshot };

// Fills `variant_id` for variants whose SKU matches a live variant and computes the two
// hashes used to refuse an edit that changes nothing.
const prepareContentStep = createStep(
  "prepare-vendor-content",
  async (input: PrepareInput, { container }) => {
    const live = await loadLiveSnapshotByProduct(container, input.product_id);
    const content = withLiveVariantIds(live, input.content);
    return new StepResponse({
      content,
      live_hash: comparableHash(live),
      proposed_hash: comparableHash(content),
    });
  }
);

const assertChangedStep = createStep(
  "assert-content-changed",
  async (input: { live_hash: string; proposed_hash: string }) => {
    if (input.live_hash === input.proposed_hash) {
      throw catalogError("no_changes", "The content is the same as the live content.");
    }
    return new StepResponse(true);
  }
);

type ApplyInput = { product_id: string; content: ContentSnapshot; image_urls: string[] };

// Direct write for a product that is not live. The compensation writes the previous content
// back; variants that were removed come back as new variants, which is acceptable because a
// product that is not live has no stock or orders.
const applyContentStep = createStep(
  "apply-vendor-content",
  async (input: ApplyInput, { container }) => {
    const previous = await loadLiveSnapshotByProduct(container, input.product_id);
    const product = await readCoreProduct(container, input.product_id);
    const previousUrls = [...((product.images ?? []) as { url: string; rank?: number }[])]
      .sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0))
      .map((image) => image.url);

    try {
      await applyContentToProduct(container, {
        productId: input.product_id,
        content: input.content,
        imageUrls: input.image_urls,
      });
    } catch (error) {
      // A throwing step does not run its own compensation: put the previous content back here.
      await applyContentToProduct(container, {
        productId: input.product_id,
        content: previous,
        imageUrls: previousUrls,
      }).catch(() => undefined);
      throw error;
    }
    const readBack = await loadLiveSnapshotByProduct(container, input.product_id);
    return new StepResponse(
      { content_hash: contentHash(readBack) },
      { product_id: input.product_id, content: previous, image_urls: previousUrls }
    );
  },
  async (compensation, { container }) => {
    if (compensation) {
      await applyContentToProduct(container, {
        productId: compensation.product_id,
        content: compensation.content,
        imageUrls: compensation.image_urls,
      });
    }
  }
);

/**
 * A vendor edit. A product that is not live is rewritten directly. A live product only gets
 * a pending revision: this workflow has no path to a core product write for a live product,
 * so the live version keeps selling its approved content until the review decides.
 */
export const vendorUpdateProductWorkflow = createWorkflow(
  "vendor-update-product",
  function (input: VendorUpdateProductInput) {
    assertVendorEligibleStep({ vendor_id: input.vendor_id });
    const loaded = loadOwnedSubmissionStep({
      vendor_id: input.vendor_id,
      product_id: input.product_id,
    });
    const decision = transform({ loaded }, ({ loaded }) => ({
      live: loaded.is_live,
      event: (loaded.is_live ? "live_edit" : "edit") as SubmissionEvent,
    }));
    assertTransitionStep({ submission_id: loaded.submission_id, event: decision.event });

    const prepared = prepareContentStep({ product_id: input.product_id, content: input.content });
    const imageUrls = validateContentRefsStep({
      vendor_id: input.vendor_id,
      product_id: input.product_id,
      content: prepared.content,
    });

    const direct = when({ decision }, ({ decision }) => decision.live === false).then(() => {
      const applied = applyContentStep({
        product_id: input.product_id,
        content: prepared.content,
        image_urls: imageUrls,
      });
      return transitionSubmissionStep({
        submission_id: loaded.submission_id,
        vendor_id: input.vendor_id,
        event: "edit",
        content_hash: applied.content_hash,
        bump_revision: true,
      });
    });

    const live = when({ decision }, ({ decision }) => decision.live === true).then(() => {
      assertChangedStep({
        live_hash: prepared.live_hash,
        proposed_hash: prepared.proposed_hash,
      });
      checkVariantRemovalStep({ product_id: input.product_id, content: prepared.content });
      const uploadIds = transform({ prepared }, ({ prepared }) =>
        prepared.content.images.map((image) => image.upload_id)
      );
      attachUploadsStep({ product_id: input.product_id, upload_ids: uploadIds });
      const pendingHash = transform({ prepared }, ({ prepared }) => contentHash(prepared.content));
      const transitioned = transitionSubmissionStep({
        submission_id: loaded.submission_id,
        vendor_id: input.vendor_id,
        event: "live_edit",
        pending: prepared.content,
        content_hash: pendingHash,
        bump_revision: true,
        mark_submitted: true,
      }).config({ name: "transition-submission-live-edit" });
      const emitted = transform({ transitioned, input }, ({ transitioned, input }) => ({
        eventName: "catalog.submitted",
        data: {
          submission_id: transitioned.submission_id,
          product_id: input.product_id,
          vendor_id: input.vendor_id,
          revision: transitioned.after.revision,
          live: true,
        },
      }));
      emitEventStep(emitted);
      return transitioned;
    });

    const result = transform({ direct, live }, ({ direct, live }) => direct ?? live);
    return new WorkflowResponse(result);
  }
);
