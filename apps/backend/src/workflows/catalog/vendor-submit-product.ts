import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  when,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { emitEventStep } from "@medusajs/medusa/core-flows";
import { vendorContentSchema } from "../../lib/catalog/content-snapshot";
import { catalogError } from "../../lib/catalog/errors";
import { loadEffectiveSnapshot } from "../../lib/catalog/load-content";
import {
  assertTransitionStep,
  loadOwnedSubmissionStep,
  setCoreStatusStep,
  transitionSubmissionStep,
} from "../steps/catalog/transition-submission";
import { assertVendorEligibleStep } from "../steps/catalog/validate-content-refs";

export type VendorSubmitProductInput = { vendor_id: string; product_id: string };

// The stored content is checked again against the strict schema: a draft whose core data was
// changed outside the vendor routes cannot reach review in a broken state.
const assertContentCompleteStep = createStep(
  "assert-content-complete",
  async (input: { submission_id: string }, { container }) => {
    const snapshot = await loadEffectiveSnapshot(container, input.submission_id);
    const parsed = vendorContentSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw catalogError("incomplete_content", "The product is not complete.", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      });
    }
    return new StepResponse(true);
  }
);

/**
 * Sends a product to review. A product that is not live gets the core status `proposed`; it
 * stays invisible in the Store API because it has no sales channel. A live product in
 * changes-requested state keeps its core product untouched: only the pending revision is
 * reviewed. This workflow never publishes anything.
 */
export const vendorSubmitProductWorkflow = createWorkflow(
  "vendor-submit-product",
  function (input: VendorSubmitProductInput) {
    assertVendorEligibleStep({ vendor_id: input.vendor_id });
    const loaded = loadOwnedSubmissionStep({
      vendor_id: input.vendor_id,
      product_id: input.product_id,
    });
    assertTransitionStep({ submission_id: loaded.submission_id, event: "submit" });
    assertContentCompleteStep({ submission_id: loaded.submission_id });

    const transitioned = transitionSubmissionStep({
      submission_id: loaded.submission_id,
      vendor_id: input.vendor_id,
      event: "submit",
      mark_submitted: true,
    });

    when({ loaded }, ({ loaded }) => loaded.is_live === false).then(() => {
      setCoreStatusStep({ product_id: input.product_id, status: "proposed" });
    });

    const emitted = transform({ transitioned, loaded, input }, ({ transitioned, loaded, input }) => ({
      eventName: "catalog.submitted",
      data: {
        submission_id: transitioned.submission_id,
        product_id: input.product_id,
        vendor_id: input.vendor_id,
        revision: transitioned.after.revision,
        live: loaded.is_live,
      },
    }));
    emitEventStep(emitted);

    return new WorkflowResponse(transitioned);
  }
);
