import { MedusaError } from "@medusajs/framework/utils";
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { STAFF_ACCESS_MODULE } from "../../modules/staff-access";

type Review = {
  id: string;
  actor_user_id: string;
  closed_at: Date | string | null;
  closed_by: string | null;
  rotated_confirmed: boolean;
  note: string | null;
};

type StaffAccessApi = {
  listBreakGlassReviews(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<Review[]>;
  updateBreakGlassReviews(data: Record<string, unknown>): Promise<Review>;
  listStaffAssignments(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<Array<{ role_key: string; is_break_glass: boolean }>>;
};

export type CloseBreakGlassReviewStepInput = {
  review_id: string;
  closer: { id: string; label: string | null };
  rotated_confirmed: boolean;
  note: string;
};

export const validateCloseBreakGlassReviewStep = createStep(
  "validate-close-break-glass-review",
  async (input: CloseBreakGlassReviewStepInput, { container }) => {
    const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);

    const [review] = await staff.listBreakGlassReviews({ id: [input.review_id] }, { take: 1 });
    if (!review) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "Review not found", "review_not_found");
    }
    if (review.closed_at) {
      throw new MedusaError(MedusaError.Types.CONFLICT, "This review is already closed.", "already_closed");
    }
    if (input.closer.id === review.actor_user_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "A different superadmin has to close this review.",
        "same_account"
      );
    }

    const assignments = await staff.listStaffAssignments({ user_id: input.closer.id }, { take: null });
    const isSuperadmin = assignments.some((row) => row.role_key === "superadmin");
    const isBreakGlass = assignments.some((row) => row.is_break_glass);
    if (!isSuperadmin || isBreakGlass) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Only a superadmin who is not the break-glass account can close a review.",
        "closer_not_allowed"
      );
    }
    if (input.rotated_confirmed !== true) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Confirm that the break-glass credentials were rotated.",
        "rotation_not_confirmed"
      );
    }
    const note = input.note.trim();
    if (note.length < 10 || note.length > 500) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The note needs 10 to 500 characters.",
        "note_too_short"
      );
    }
    return new StepResponse({ note });
  }
);

export const closeBreakGlassReviewStep = createStep(
  "close-break-glass-review",
  async (input: { review_id: string; closed_by: string; note: string }, { container }) => {
    const staff = container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE);
    const closed = await staff.updateBreakGlassReviews({
      id: input.review_id,
      closed_at: new Date(),
      closed_by: input.closed_by,
      rotated_confirmed: true,
      note: input.note,
    });
    return new StepResponse(closed, input.review_id);
  },
  async (reviewId, { container }) => {
    if (!reviewId) {
      return;
    }
    // Reopen the review if a later step fails.
    await container.resolve<StaffAccessApi>(STAFF_ACCESS_MODULE).updateBreakGlassReviews({
      id: reviewId,
      closed_at: null,
      closed_by: null,
      rotated_confirmed: false,
      note: null,
    });
  }
);
