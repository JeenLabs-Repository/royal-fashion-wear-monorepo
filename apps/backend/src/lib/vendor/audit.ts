import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { recordAudit, type AuditAction, type RecordAuditInput } from "../audit";

export type VendorAuditEvent = {
  action: AuditAction;
  /** The vendor id */
  target_id: string;
  actor: { type: "user" | "vendor" | "system"; id?: string; label?: string };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

/**
 * The only place in the vendor code that knows the shape of the audit helper.
 * Callers must never pass tokens, passwords or hashes in `before`, `after`
 * or `meta`.
 */
export async function auditVendorEvent(
  container: Parameters<typeof recordAudit>[0],
  event: VendorAuditEvent
): Promise<void> {
  const input: RecordAuditInput = {
    action: event.action,
    actor: { type: event.actor.type, id: event.actor.id, label: event.actor.label },
    target: { type: "vendor", id: event.target_id },
    before: event.before,
    after: event.after,
    meta: event.meta,
  };
  await recordAudit(container, input);
}

// Fails closed: if the row cannot be written the workflow fails and its earlier
// steps roll back. Place it last, because a written row is never removed.
export const auditVendorEventStep = createStep(
  "audit-vendor-event",
  async (input: { event: VendorAuditEvent }, { container }) => {
    await auditVendorEvent(container, input.event);
    return new StepResponse({ recorded: true });
  }
);
