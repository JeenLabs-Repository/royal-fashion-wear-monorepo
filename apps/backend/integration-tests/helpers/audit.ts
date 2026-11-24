import type { MedusaContainer } from "@medusajs/framework/types";
import { AUDIT_LOG_MODULE } from "../../src/modules/audit-log";
import type { AuditRow } from "./staff-users";

type AuditReader = {
  listAuditEntries(
    filter: Record<string, unknown>,
    config?: Record<string, unknown>
  ): Promise<AuditRow[]>;
};

/**
 * Audit rows for one action, newest first. This is the only test helper that
 * touches the audit module's list method.
 */
export async function findAuditEntries(
  container: MedusaContainer,
  filter: { action: string; target_id?: string }
): Promise<AuditRow[]> {
  const audit = container.resolve<AuditReader>(AUDIT_LOG_MODULE);
  return audit.listAuditEntries(
    {
      action: filter.action,
      ...(filter.target_id ? { target_id: filter.target_id } : {}),
    },
    { order: { at: "DESC" }, take: 100 }
  );
}
