import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { acquireLockStep, emitEventStep, releaseLockStep } from "@medusajs/medusa/core-flows";
import { recordAuditStep } from "../../lib/audit/record-audit-step";
import { applyContentToProduct } from "../../lib/catalog/apply-content";
import { contentHash, type ContentSnapshot } from "../../lib/catalog/content-snapshot";
import { diffSnapshots } from "../../lib/catalog/diff";
import { catalogError } from "../../lib/catalog/errors";
import {
  getCatalogService,
  loadLiveSnapshotByProduct,
  readCoreProduct,
  withLiveVariantIds,
} from "../../lib/catalog/load-content";
import type { ApproveBody } from "../../lib/catalog/middlewares/review-decisions";
import { assignPlatformIdentifiersStep } from "../steps/catalog/assign-platform-identifiers";
import { checkVariantRemovalStep } from "../steps/catalog/check-variant-removal";
import {
  assertDecisionEligibleStep,
  decisionLockKey,
  finalizeDecisionStep,
  loadDecisionStep,
  toPlatformPrices,
  validateApprovalStep,
  writeApprovalToCoreStep,
} from "../steps/catalog/decision-steps";

export type ApplyLiveEditInput = {
  submission_id: string;
  actor: { id: string; label: string | null };
  body: ApproveBody;
};

type Row = Record<string, any>;

// The pending revision with variant ids filled in, the live content it replaces and the image
// URLs in display order. Uploads were attached to the product when the vendor saved the edit.
const preparePendingStep = createStep(
  "prepare-pending-revision",
  async (input: { submission_id: string; product_id: string }, { container }) => {
    const service = getCatalogService(container);
    const [row] = (await service.listProductSubmissions({ id: input.submission_id }, { take: 1 })) as Row[];
    const pending = row?.pending_changes as ContentSnapshot | null | undefined;
    if (!pending) {
      throw catalogError("invalid_transition", "There is no pending revision to apply.");
    }
    const live = await loadLiveSnapshotByProduct(container, input.product_id);
    const content = withLiveVariantIds(live, pending);
    const uploadIds = content.images.map((image) => image.upload_id);
    const uploads = (await service.listVendorUploads({ id: uploadIds }, { take: null })) as Row[];
    const urlById = new Map(uploads.map((upload) => [String(upload.id), String(upload.url)]));
    const imageUrls = uploadIds.map((id) => {
      const url = urlById.get(id);
      if (!url) {
        throw catalogError("unknown_upload", "Upload not found.");
      }
      return url;
    });
    return new StepResponse({ content, live, image_urls: imageUrls });
  }
);

type ApplyInput = { product_id: string; content: ContentSnapshot; image_urls: string[] };

// Writes the approved content to the live product. The compensation writes the previous live
// content back; a removed variant comes back as a new variant, which is acceptable because the
// removal check proved it held no stock, reservation or open order.
const applyPendingStep = createStep(
  "apply-pending-revision",
  async (input: ApplyInput, { container }) => {
    const previous = await loadLiveSnapshotByProduct(container, input.product_id);
    const product = await readCoreProduct(container, input.product_id);
    const previousUrls = [...((product.images ?? []) as { url: string; rank?: number }[])]
      .sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0))
      .map((image) => image.url);
    await applyContentToProduct(container, {
      productId: input.product_id,
      content: input.content,
      imageUrls: input.image_urls,
    });
    return new StepResponse(
      { applied: true },
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

// Hash of the content the approver approved, for the audit entry.
const hashOf = (content: ContentSnapshot): string => contentHash(content);

/**
 * Approval of a pending revision of a live product. The live product keeps selling until the
 * content write; handle, status and sales channel link are never part of this workflow. New
 * variants get fresh platform SKUs, existing SKUs stay.
 */
export const applyLiveEditWorkflow = createWorkflow(
  "apply-live-edit",
  function (input: ApplyLiveEditInput) {
    const lockKey = transform({ input }, ({ input }) => decisionLockKey(input.submission_id));
    acquireLockStep({ key: lockKey, timeout: 10, ttl: 60 });

    const loaded = loadDecisionStep({
      submission_id: input.submission_id,
      content_hash: input.body.content_hash,
      event: "approve",
      live: true,
    });
    assertDecisionEligibleStep({ vendor_id: loaded.vendor_id });
    const validated = validateApprovalStep({
      submission_id: input.submission_id,
      product_id: loaded.product_id,
      live: true,
      body: input.body,
    });
    const prepared = preparePendingStep({
      submission_id: input.submission_id,
      product_id: loaded.product_id,
    });
    checkVariantRemovalStep({ product_id: loaded.product_id, content: prepared.content });
    applyPendingStep({
      product_id: loaded.product_id,
      content: prepared.content,
      image_urls: prepared.image_urls,
    });

    const identifiers = assignPlatformIdentifiersStep({
      product_id: loaded.product_id,
      title: validated.title,
      assign_handle: false,
    });
    const written = writeApprovalToCoreStep({
      product_id: loaded.product_id,
      handle: null,
      publish: false,
      gst_class: input.body.gst_class,
      hsn: input.body.hsn,
      category_id: input.body.category_id,
      origin_country: validated.origin_country,
      skus: identifiers.skus,
      prices_by_sku: validated.prices_by_sku,
    });

    const confirmed = transform({ input }, ({ input }) => ({
      category_id: input.body.category_id,
      gst_class: input.body.gst_class,
      hsn: input.body.hsn,
    }));
    const finalized = finalizeDecisionStep({
      submission_id: input.submission_id,
      event: "approve",
      reviewer_user_id: input.actor.id,
      approved_content_hash: input.body.content_hash,
      confirmed,
    });

    const auditInput = transform(
      { input, loaded, validated, written, prepared, finalized },
      ({ input, loaded, validated, written, prepared, finalized }) => ({
        action: "product.changes_applied" as const,
        actor: { id: input.actor.id, type: "user" as const, label: input.actor.label },
        target: { type: "product", id: loaded.product_id },
        before: {
          state: finalized.before.state,
          category_id: loaded.proposed_category_id,
          gst_class: loaded.proposed_gst_class,
          hsn: loaded.proposed_hsn,
        },
        after: {
          state: finalized.after.state,
          checklist: input.body.checklist,
          content_hash: input.body.content_hash,
          approved_pending_hash: hashOf(prepared.content),
          category_id: input.body.category_id,
          gst_class: input.body.gst_class,
          hsn: input.body.hsn,
          selling_prices: toPlatformPrices(validated.selling_prices, written.platform_skus),
        },
        meta: {
          approver_edits: loaded.approver_edits,
          changes: diffSnapshots(prepared.live, prepared.content),
        },
      })
    );
    recordAuditStep(auditInput);
    releaseLockStep({ key: lockKey });

    const emitted = transform({ finalized }, ({ finalized }) => ({
      eventName: "catalog.changes_applied",
      data: {
        submission_id: finalized.submission_id,
        product_id: finalized.product_id,
        vendor_id: finalized.vendor_id,
        revision: finalized.revision,
      },
    }));
    emitEventStep(emitted);

    return new WorkflowResponse(finalized);
  }
);
