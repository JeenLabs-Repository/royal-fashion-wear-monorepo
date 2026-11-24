import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import {
  type AuditReader,
  auditQuerySchema,
  queryAuditEntries,
  toAuditResponse,
} from "../../../lib/audit/query";
import { AUDIT_LOG_MODULE } from "../../../modules/audit-log";

// Read only. The permission decision (audit:read) is made by the admin chain.
// There is no export, update or delete route on purpose.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "query"} ${issue.message}`)
        .join("; "),
      "invalid_query"
    );
  }

  const service = req.scope.resolve(AUDIT_LOG_MODULE) as unknown as AuditReader;
  const { rows, next_cursor } = await queryAuditEntries(service, parsed.data);

  res.json({ entries: rows.map(toAuditResponse), next_cursor });
}
