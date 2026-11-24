import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { listStaff } from "../../../lib/staff/list-staff";

// Validated here, not in a per-route middleware entry, so the admin chain always
// runs first. Unknown keys are a 400. Spike S1 showed a per-route validator runs
// after the chain; handler validation stays until the decision record (later)
// records the skill-preferred switch.
const QuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((issue) => issue.message).join("; "),
      "invalid_query"
    );
  }
  res.json(await listStaff(req.scope, parsed.data));
}
