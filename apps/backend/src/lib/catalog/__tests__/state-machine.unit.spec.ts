import { MedusaError } from "@medusajs/framework/utils";
import {
  allowedEvents,
  SUBMISSION_EVENTS,
  SUBMISSION_STATES,
  transition,
  type PendingAction,
  type SubmissionEvent,
  type SubmissionState,
} from "../state-machine";

type Expected = [SubmissionState, boolean, PendingAction];

// Written out independently of the table in the module: key is
// `state:is_live:event`, value is the expected next position and pending action.
const EXPECTED: Record<string, Expected> = {
  "draft:false:edit": ["draft", false, "keep"],
  "draft:false:submit": ["submitted", false, "keep"],
  "submitted:false:withdraw": ["withdrawn", false, "clear"],
  "submitted:false:approve": ["approved", true, "clear"],
  "submitted:false:request_changes": ["changes_requested", false, "keep"],
  "submitted:false:reject": ["rejected", false, "keep"],
  "submitted:true:live_edit": ["submitted", true, "set"],
  "submitted:true:discard_pending": ["approved", true, "clear"],
  "submitted:true:withdraw": ["withdrawn", false, "clear"],
  "submitted:true:approve": ["approved", true, "clear"],
  "submitted:true:request_changes": ["changes_requested", true, "keep"],
  "submitted:true:reject": ["approved", true, "clear"],
  "approved:true:live_edit": ["submitted", true, "set"],
  "approved:true:withdraw": ["withdrawn", false, "clear"],
  "changes_requested:false:edit": ["changes_requested", false, "keep"],
  "changes_requested:false:submit": ["submitted", false, "keep"],
  "changes_requested:false:withdraw": ["withdrawn", false, "clear"],
  "changes_requested:true:submit": ["submitted", true, "keep"],
  "changes_requested:true:live_edit": ["submitted", true, "set"],
  "changes_requested:true:discard_pending": ["approved", true, "clear"],
  "changes_requested:true:withdraw": ["withdrawn", false, "clear"],
  "withdrawn:false:edit": ["withdrawn", false, "keep"],
  "withdrawn:false:submit": ["submitted", false, "keep"],
};

const cases: [SubmissionState, boolean, SubmissionEvent][] = [];
for (const state of SUBMISSION_STATES) {
  for (const isLive of [false, true]) {
    for (const event of SUBMISSION_EVENTS) {
      cases.push([state, isLive, event]);
    }
  }
}

const thrownCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as MedusaError).code;
  }
  return undefined;
};

const expectedCode = (state: SubmissionState, isLive: boolean, event: SubmissionEvent) => {
  if (state === "rejected") {
    return "rejected_final";
  }
  if (state === "submitted" && !isLive && event === "edit") {
    return "locked_in_review";
  }
  return "invalid_transition";
};

describe("submission state machine: full matrix", () => {
  it("covers 6 states, 2 live flags and 8 events", () => {
    expect(cases).toHaveLength(96);
  });

  it.each(cases)("%s live=%s %s", (state, isLive, event) => {
    const expected = EXPECTED[`${state}:${isLive}:${event}`];
    if (expected) {
      expect(transition({ state, is_live: isLive }, event)).toEqual({
        state: expected[0],
        is_live: expected[1],
        pending: expected[2],
      });
      return;
    }
    let caught: unknown;
    try {
      transition({ state, is_live: isLive }, event);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MedusaError);
    expect((caught as MedusaError).type).toBe(MedusaError.Types.NOT_ALLOWED);
    expect((caught as MedusaError).code).toBe(expectedCode(state, isLive, event));
  });

  it("the allowed set equals the written table for every position", () => {
    for (const state of SUBMISSION_STATES) {
      for (const isLive of [false, true]) {
        const written = SUBMISSION_EVENTS.filter(
          (event) => EXPECTED[`${state}:${isLive}:${event}`] !== undefined
        );
        expect(allowedEvents({ state, is_live: isLive })).toEqual(written);
      }
    }
  });
});

describe("submission state machine: named rules", () => {
  it("rejected is final for every event", () => {
    for (const event of SUBMISSION_EVENTS) {
      for (const isLive of [false, true]) {
        expect(thrownCode(() => transition({ state: "rejected", is_live: isLive }, event))).toBe(
          "rejected_final"
        );
      }
    }
  });

  it("a live edit replaces the single pending revision", () => {
    for (const state of ["approved", "submitted", "changes_requested"] as const) {
      expect(transition({ state, is_live: true }, "live_edit")).toEqual({
        state: "submitted",
        is_live: true,
        pending: "set",
      });
    }
  });

  it("rejecting a live edit leaves the live product selling and clears the pending revision", () => {
    expect(transition({ state: "submitted", is_live: true }, "reject")).toEqual({
      state: "approved",
      is_live: true,
      pending: "clear",
    });
  });

  it("rejecting a first submission is final and not live", () => {
    expect(transition({ state: "submitted", is_live: false }, "reject")).toEqual({
      state: "rejected",
      is_live: false,
      pending: "keep",
    });
  });

  it("a submission in review cannot be edited directly", () => {
    expect(thrownCode(() => transition({ state: "submitted", is_live: false }, "edit"))).toBe(
      "locked_in_review"
    );
  });

  it("a live product cannot be edited directly, only through a live edit", () => {
    for (const state of ["approved", "submitted", "changes_requested"] as const) {
      expect(thrownCode(() => transition({ state, is_live: true }, "edit"))).toBe(
        "invalid_transition"
      );
    }
  });

  it("withdraw removes the product from sale and clears the pending revision", () => {
    expect(transition({ state: "approved", is_live: true }, "withdraw")).toEqual({
      state: "withdrawn",
      is_live: false,
      pending: "clear",
    });
  });

  it("discarding a pending revision is refused for a product that is not live", () => {
    for (const state of ["draft", "submitted", "changes_requested", "withdrawn"] as const) {
      expect(() => transition({ state, is_live: false }, "discard_pending")).toThrow(MedusaError);
    }
  });

  it("does not mutate the table: two calls return separate objects", () => {
    const first = transition({ state: "draft", is_live: false }, "submit");
    first.pending = "clear";
    expect(transition({ state: "draft", is_live: false }, "submit").pending).toBe("keep");
  });
});
