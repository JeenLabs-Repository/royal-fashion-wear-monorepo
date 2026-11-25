import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { assertEligible } from "../../lib/catalog/assert-eligible";
import { applyStockLevelsStep } from "../steps/stock/apply-stock-levels";
import { auditStockChangesStep } from "../steps/stock/audit-stock-changes";
import {
  validateStockEntriesStep,
  type StockEntryCode,
  type StockEntryInput,
} from "../steps/stock/validate-stock-entries";

export type SetVendorStockInput = {
  vendor_id: string;
  actor: { id: string; label: string | null };
  entries: StockEntryInput[];
  mode: "strict" | "partial";
};

export type StockEntryResult =
  | { index: number; status: "applied" | "unchanged" }
  | { index: number; status: "rejected"; code: StockEntryCode; reserved?: number };

const assertStockEligibleStep = createStep(
  "assert-stock-eligible",
  async (input: { vendor_id: string }, { container }) => {
    await assertEligible(container, input.vendor_id);
    return new StepResponse(true);
  }
);

/**
 * Sets absolute stock quantities for a vendor's own locations. Order: eligibility, validation
 * (nothing is written yet), the core inventory writes, the audit entries. A new reservation can
 * still land between validation and write; core's own checks and the routing release's drift job
 * are the backstop.
 */
export const setVendorStockWorkflow = createWorkflow(
  "set-vendor-stock",
  (input: SetVendorStockInput) => {
    assertStockEligibleStep({ vendor_id: input.vendor_id });
    const validated = validateStockEntriesStep({
      vendor_id: input.vendor_id,
      entries: input.entries,
      mode: input.mode,
    });
    const changes = transform({ validated }, ({ validated }) =>
      validated.resolved.filter((entry) => entry.changed)
    );
    applyStockLevelsStep({ entries: changes });
    auditStockChangesStep({ actor: input.actor, entries: changes });

    const results = transform({ input, validated }, ({ input, validated }) =>
      input.entries.map((entry): StockEntryResult => {
        const problem = validated.problems.find((item) => item.index === entry.index);
        if (problem) {
          return {
            index: entry.index,
            status: "rejected",
            code: problem.code,
            ...(problem.reserved !== undefined ? { reserved: problem.reserved } : {}),
          };
        }
        const resolved = validated.resolved.find((item) => item.index === entry.index);
        return { index: entry.index, status: resolved?.changed ? "applied" : "unchanged" };
      })
    );
    return new WorkflowResponse({ results });
  }
);
