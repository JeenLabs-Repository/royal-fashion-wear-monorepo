import { MedusaError } from "@medusajs/framework/utils";

export const SUBMISSION_STATES = [
  "draft",
  "submitted",
  "approved",
  "changes_requested",
  "rejected",
  "withdrawn",
] as const;

export const SUBMISSION_EVENTS = [
  "edit",
  "submit",
  "live_edit",
  "discard_pending",
  "withdraw",
  "approve",
  "request_changes",
  "reject",
] as const;

export type SubmissionState = (typeof SUBMISSION_STATES)[number];
export type SubmissionEvent = (typeof SUBMISSION_EVENTS)[number];

/** What to do with the single pending revision: leave it, replace it or remove it. */
export type PendingAction = "keep" | "set" | "clear";

export type SubmissionPosition = { state: SubmissionState; is_live: boolean };
export type TransitionResult = SubmissionPosition & { pending: PendingAction };

type Row = Partial<Record<SubmissionEvent, TransitionResult>>;

const to = (
  state: SubmissionState,
  is_live: boolean,
  pending: PendingAction
): TransitionResult => ({ state, is_live, pending });

const positionKey = (state: SubmissionState, isLive: boolean): string =>
  `${state}:${isLive ? "live" : "not_live"}`;

// One row per position. A position or event missing here is not allowed.
// A submission that is live keeps selling its approved content while a
// pending revision waits for review; a rejected submission is final.
export const TRANSITION_TABLE: Readonly<Record<string, Row>> = {
  "draft:not_live": {
    edit: to("draft", false, "keep"),
    submit: to("submitted", false, "keep"),
  },
  "submitted:not_live": {
    withdraw: to("withdrawn", false, "clear"),
    approve: to("approved", true, "clear"),
    request_changes: to("changes_requested", false, "keep"),
    reject: to("rejected", false, "keep"),
  },
  "submitted:live": {
    live_edit: to("submitted", true, "set"),
    discard_pending: to("approved", true, "clear"),
    withdraw: to("withdrawn", false, "clear"),
    approve: to("approved", true, "clear"),
    request_changes: to("changes_requested", true, "keep"),
    // A rejected live edit leaves the live product selling.
    reject: to("approved", true, "clear"),
  },
  "approved:live": {
    live_edit: to("submitted", true, "set"),
    withdraw: to("withdrawn", false, "clear"),
  },
  "changes_requested:not_live": {
    edit: to("changes_requested", false, "keep"),
    submit: to("submitted", false, "keep"),
    withdraw: to("withdrawn", false, "clear"),
  },
  "changes_requested:live": {
    submit: to("submitted", true, "keep"),
    live_edit: to("submitted", true, "set"),
    discard_pending: to("approved", true, "clear"),
    withdraw: to("withdrawn", false, "clear"),
  },
  "withdrawn:not_live": {
    edit: to("withdrawn", false, "keep"),
    submit: to("submitted", false, "keep"),
  },
};

/** Events allowed from a position, in event-list order. */
export function allowedEvents(current: SubmissionPosition): SubmissionEvent[] {
  if (current.state === "rejected") {
    return [];
  }
  const row = TRANSITION_TABLE[positionKey(current.state, current.is_live)] ?? {};
  return SUBMISSION_EVENTS.filter((event) => row[event] !== undefined);
}

/**
 * The next position for an event, or a MedusaError of type not_allowed with a
 * stable code: rejected_final, locked_in_review or invalid_transition.
 */
export function transition(
  current: SubmissionPosition,
  event: SubmissionEvent
): TransitionResult {
  if (current.state === "rejected") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "A rejected submission is final. Create a new draft instead.",
      "rejected_final"
    );
  }
  const result = TRANSITION_TABLE[positionKey(current.state, current.is_live)]?.[event];
  if (result) {
    return { ...result };
  }
  if (event === "edit" && current.state === "submitted" && !current.is_live) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This product is in review and cannot be edited until the review finishes.",
      "locked_in_review"
    );
  }
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    current.is_live && event === "edit"
      ? "A live product is changed with a live edit."
      : `The action ${event} is not allowed while the submission is ${current.state}.`,
    "invalid_transition"
  );
}
