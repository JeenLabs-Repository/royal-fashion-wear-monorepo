import { MedusaError } from "@medusajs/framework/utils";
import { acquireLockStep, releaseLockStep } from "@medusajs/medusa/core-flows";
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
  type WorkflowData,
} from "@medusajs/framework/workflows-sdk";
import { applyContentToProduct } from "../../lib/catalog/apply-content";
import { contentHash, type ContentSnapshot } from "../../lib/catalog/content-snapshot";
import { catalogError } from "../../lib/catalog/errors";
import { loadEffectiveSnapshot } from "../../lib/catalog/load-content";
import { normalizePlainText } from "../../lib/catalog/text";
import {
  getCatalogApi,
  loadImageUrls,
  type SubmissionRow,
} from "../steps/catalog/load-review";

export type EditReviewContentInput = {
  submission_id: string;
  expected_hash: string;
  title?: string;
  description?: string;
  image_upload_ids?: string[];
};

type FieldChange = { field: string; before: string; after: string };

/** The proposed list must hold exactly the current images, in any order. */
export function assertImagePermutation(current: string[], proposed: string[]): void {
  const valid =
    current.length === proposed.length &&
    new Set(proposed).size === proposed.length &&
    proposed.every((id) => current.includes(id));
  if (!valid) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The image list must hold the same images in a new order.",
      "invalid_image_order"
    );
  }
}

/** The first `before` of a field is kept; `after` always follows the latest edit. */
export function mergeApproverEdits(existing: unknown, changes: FieldChange[]): FieldChange[] {
  const merged: FieldChange[] = Array.isArray(existing)
    ? (existing as FieldChange[]).map((entry) => ({ ...entry }))
    : [];
  for (const change of changes) {
    const found = merged.find((entry) => entry.field === change.field);
    if (found) {
      found.after = change.after;
    } else {
      merged.push({ ...change });
    }
  }
  return merged;
}

type Compensation = {
  submission: SubmissionRow;
  previous: ContentSnapshot;
  previous_urls: string[];
};

const editReviewContentStep = createStep(
  "edit-review-content",
  async (input: EditReviewContentInput, { container }) => {
    const catalog = getCatalogApi(container);
    const submission = await catalog.retrieveProductSubmission(input.submission_id);

    if (submission.state !== "submitted") {
      throw catalogError(
        "invalid_transition",
        "Only a product that is waiting for review can be edited."
      );
    }

    const effective = (await loadEffectiveSnapshot(container, submission.id)) as ContentSnapshot;
    if (contentHash(effective) !== input.expected_hash) {
      throw catalogError(
        "stale_revision",
        "The content changed after you opened it. Reload the page and try again."
      );
    }

    const next = { ...effective } as ContentSnapshot;
    const changes: FieldChange[] = [];

    if (input.title !== undefined) {
      next.title = normalizePlainText(input.title, 150);
      if (next.title !== effective.title) {
        changes.push({ field: "title", before: effective.title, after: next.title });
      }
    }
    if (input.description !== undefined) {
      next.description = normalizePlainText(input.description, 5000);
      if (next.description !== effective.description) {
        changes.push({
          field: "description",
          before: effective.description,
          after: next.description,
        });
      }
    }
    if (input.image_upload_ids !== undefined) {
      const current = effective.images.map((image) => image.upload_id);
      assertImagePermutation(current, input.image_upload_ids);
      next.images = input.image_upload_ids.map((upload_id) => ({ upload_id }));
      if (current.join(",") !== input.image_upload_ids.join(",")) {
        changes.push({
          field: "images",
          before: current.join(","),
          after: input.image_upload_ids.join(","),
        });
      }
    }

    const urlById = await loadImageUrls(
      container,
      [...new Set([...effective.images, ...next.images].map((image) => image.upload_id))]
    );
    const urlsFor = (snapshot: ContentSnapshot): string[] =>
      snapshot.images.map((image) => urlById.get(image.upload_id) ?? "");

    if (submission.is_live) {
      // A live edit only rewrites the pending revision; the live product is not touched.
      await catalog.updateProductSubmissions({ id: submission.id, pending_changes: next });
    } else {
      await applyContentToProduct(container, {
        productId: submission.product_id,
        content: next,
        imageUrls: urlsFor(next),
      });
    }

    const fresh = (await loadEffectiveSnapshot(container, submission.id)) as ContentSnapshot;
    await catalog.updateProductSubmissions({
      id: submission.id,
      content_hash: contentHash(fresh),
      approver_edits: mergeApproverEdits(submission.approver_edits, changes),
    });

    const compensation: Compensation = {
      submission,
      previous: effective,
      previous_urls: urlsFor(effective),
    };
    return new StepResponse({ content_hash: contentHash(fresh) }, compensation);
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return;
    }
    const catalog = getCatalogApi(container);
    const { submission, previous, previous_urls } = compensation;
    if (!submission.is_live) {
      await applyContentToProduct(container, {
        productId: submission.product_id,
        content: previous,
        imageUrls: previous_urls,
      });
    }
    await catalog.updateProductSubmissions({
      id: submission.id,
      content_hash: submission.content_hash,
      approver_edits: submission.approver_edits ?? null,
      pending_changes: submission.pending_changes ?? null,
    });
  }
);

// The lock serialises two approvers editing the same submission; the hash
// check inside the step then reports the loser as stale.
export const editReviewContentWorkflow = createWorkflow(
  "edit-review-content",
  function (input: WorkflowData<EditReviewContentInput>) {
    const key = transform({ input }, (data) => `catalog-review:${data.input.submission_id}`);
    acquireLockStep({ key, timeout: 10, ttl: 60 });
    const result = editReviewContentStep(input);
    releaseLockStep({ key });
    return new WorkflowResponse(result);
  }
);
