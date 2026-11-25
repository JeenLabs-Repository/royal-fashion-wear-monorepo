import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { recordAudit } from "../../../lib/audit";
import type { ResolvedEntry } from "./validate-stock-entries";

export type AuditStockChangesInput = {
  actor: { id: string; label: string | null };
  entries: ResolvedEntry[];
};

/**
 * One `stock.updated` entry per changed level, with the old and new quantity. The location is
 * recorded under the key `location`: the redactor blanks any key with the word `code` in it.
 * Fails closed and has no compensation, so it runs last.
 */
export const auditStockChangesStep = createStep(
  "audit-stock-changes",
  async (input: AuditStockChangesInput, { container }) => {
    for (const entry of input.entries) {
      await recordAudit(container, {
        action: "stock.updated",
        actor: { id: input.actor.id, type: "vendor", label: input.actor.label },
        target: { type: "variant", id: entry.variant_id },
        before: { stocked_quantity: entry.previous_quantity ?? 0 },
        after: { stocked_quantity: entry.stocked_quantity },
        meta: { variant_id: entry.variant_id, location: entry.location_code },
      });
    }
    return new StepResponse({ recorded: input.entries.length });
  }
);
