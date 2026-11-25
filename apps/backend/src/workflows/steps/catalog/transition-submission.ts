import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import type { ContentSnapshot } from "../../../lib/catalog/content-snapshot";
import { getCatalogService, getQuery, loadOwnedSubmission } from "../../../lib/catalog/load-content";
import { transition, type SubmissionEvent } from "../../../lib/catalog/state-machine";
import { assertOwns } from "../../../lib/vendor/assert-owns";

export type LoadOwnedSubmissionInput = { vendor_id: string; product_id: string };

/** The submission of a product, or the same 404 for an unknown product and another vendor's. */
export const loadOwnedSubmissionStep = createStep(
  "load-owned-submission",
  async (input: LoadOwnedSubmissionInput, { container }) => {
    const submission = await loadOwnedSubmission(container, input.vendor_id, input.product_id);
    return new StepResponse({
      submission_id: String(submission.id),
      state: String(submission.state),
      is_live: Boolean(submission.is_live),
      revision: Number(submission.revision),
    });
  }
);

export type AssertTransitionInput = { submission_id: string; event: SubmissionEvent };

/**
 * Dry run of the state machine, before anything is written. A refusal carries the stable
 * codes `locked_in_review`, `rejected_final` and `invalid_transition`.
 */
export const assertTransitionStep = createStep(
  "assert-submission-transition",
  async (input: AssertTransitionInput, { container }) => {
    const [row] = await getCatalogService(container).listProductSubmissions(
      { id: input.submission_id },
      { take: 1 }
    );
    if (!row) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not found");
    }
    transition({ state: row.state, is_live: row.is_live } as never, input.event);
    return new StepResponse(true);
  }
);

export type TransitionSubmissionInput = {
  submission_id: string;
  vendor_id: string;
  event: SubmissionEvent;
  /** Required when the event sets a pending revision. */
  pending?: ContentSnapshot;
  content_hash?: string;
  /** Adds 1 to the revision. */
  bump_revision?: boolean;
  /** Sets `submitted_at` to now and clears the reviewer reason. */
  mark_submitted?: boolean;
  hidden_by_suspension?: boolean;
};

type Restore = {
  id: string;
  state: string;
  is_live: boolean;
  pending_changes: unknown;
  revision: number;
  content_hash: string;
  submitted_at: Date | null;
  reason: string | null;
  hidden_by_suspension: boolean;
};

/**
 * Applies one event of the state machine to a submission and writes the state, the live
 * flag, the pending revision, the revision number and the content hash together.
 */
export const transitionSubmissionStep = createStep(
  "transition-submission",
  async (input: TransitionSubmissionInput, { container }) => {
    const service = getCatalogService(container);
    const [row] = await service.listProductSubmissions({ id: input.submission_id }, { take: 1 });
    const candidate: Record<string, unknown> | undefined = row ? { ...row } : undefined;
    assertOwns(input.vendor_id, candidate);

    const next = transition({ state: row.state, is_live: row.is_live } as never, input.event);
    const update: Record<string, unknown> = {
      id: row.id,
      state: next.state,
      is_live: next.is_live,
    };
    if (next.pending === "set") {
      if (!input.pending) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "This event needs the pending content."
        );
      }
      update.pending_changes = input.pending;
    } else if (next.pending === "clear") {
      update.pending_changes = null;
    }
    const revision = Number(row.revision) + (input.bump_revision ? 1 : 0);
    update.revision = revision;
    if (input.content_hash) {
      update.content_hash = input.content_hash;
    }
    if (input.mark_submitted) {
      update.submitted_at = new Date();
      update.reason = null;
    }
    if (input.hidden_by_suspension !== undefined) {
      update.hidden_by_suspension = input.hidden_by_suspension;
    }
    await service.updateProductSubmissions(update as never);

    const restore: Restore = {
      id: String(row.id),
      state: String(row.state),
      is_live: Boolean(row.is_live),
      pending_changes: row.pending_changes ?? null,
      revision: Number(row.revision),
      content_hash: String(row.content_hash),
      submitted_at: (row.submitted_at as Date | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      hidden_by_suspension: Boolean(row.hidden_by_suspension),
    };
    return new StepResponse(
      {
        submission_id: String(row.id),
        before: { state: String(row.state), is_live: Boolean(row.is_live) },
        after: { state: String(next.state), is_live: Boolean(next.is_live), revision },
      },
      restore
    );
  },
  async (restore, { container }) => {
    if (restore) {
      await getCatalogService(container).updateProductSubmissions(restore as never);
    }
  }
);

export type SetCoreStatusInput = { product_id: string; status: "draft" | "proposed" };

/**
 * Sets the core product status to one of the two values a vendor action may write. Nothing
 * in the vendor workflows can write a published status.
 */
export const setCoreStatusStep = createStep(
  "set-core-product-status",
  async (input: SetCoreStatusInput, { container }) => {
    const { data } = await getQuery(container).graph({
      entity: "product",
      fields: ["id", "status"],
      filters: { id: input.product_id },
    });
    const previous = String(data[0]?.status ?? "draft");
    await updateProductsWorkflow(container).run({
      input: { selector: { id: input.product_id }, update: { status: input.status } as never },
    });
    return new StepResponse({ previous }, { product_id: input.product_id, previous });
  },
  async (compensation, { container }) => {
    if (compensation) {
      await updateProductsWorkflow(container).run({
        input: {
          selector: { id: compensation.product_id },
          update: { status: compensation.previous } as never,
        },
      });
    }
  }
);
